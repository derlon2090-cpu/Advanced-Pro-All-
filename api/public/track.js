import { createHmac, timingSafeEqual } from 'node:crypto';
import activityHandler from '../../lib/activity-api.js';
import verifyDeviceHandler from '../../lib/verify-device-api.js';
import { sendReminderConfirmation } from '../../lib/renewal-email.js';

const buckets = new Map();
const clientIp = request => String(request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown').split(',')[0].trim().slice(0, 128);
const allowed = request => {
  const now = Date.now(), key = clientIp(request), recent = (buckets.get(key) || []).filter(time => now - time < 60_000);
  if (recent.length >= 30) { buckets.set(key, recent); return false; }
  recent.push(now); buckets.set(key, recent); return true;
};
const database = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
};
const cleanToken = value => /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || '')) ? String(value) : '';
const deviceSecret = () => process.env.DEVICE_DNA_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const deviceSession = (request, orderId) => {
  const cookie = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ap_device='));
  if (!cookie || !deviceSecret()) return false;
  const value = decodeURIComponent(cookie.slice('ap_device='.length)), parts = value.split('.');
  if (parts.length !== 4) return false;
  const [sessionOrderId, physicalHash, expires, supplied] = parts;
  if (sessionOrderId !== orderId || !/^[a-f0-9]{64}$/.test(physicalHash) || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', deviceSecret()).update(`${sessionOrderId}.${physicalHash}.${expires}`).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? { physicalHash } : null;
};
const publicUrl = value => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
};
const maskEmail = value => { const [name, domain] = String(value || '').split('@'); return name && domain ? `${name.slice(0, 1)}***@${domain}` : null; };

export default async function handler(request, response) {
  if (request.query?._route === 'activity') return activityHandler(request, response);
  if (request.query?._route === 'verify-device') return verifyDeviceHandler(request, response);
  if (!['GET', 'POST'].includes(request.method)) return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (!allowed(request)) return response.status(429).setHeader('Retry-After', '60').json({ message: 'طلبات كثيرة، حاول بعد دقيقة.' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ message: 'خدمة الطلبات غير متاحة مؤقتًا.' });
  const token = cleanToken(request.query?.token || request.body?.token);
  if (!token) return response.status(400).json({ message: 'رابط الطلب غير صالح.' });

  const select = 'id,order_number,product_name,service_type,status,duration_days,starts_at,expires_at,has_warranty,warranty_days,warranty_expires_at,acknowledgment_text,acknowledged_at,tracking_token,customer_email,reminder_email,reminder_subscribed_at,renewal_url,renewal_discount_code,customers(name),account_assignments(email_accounts(mailbox_alias))';
  const params = new URLSearchParams({ select, tracking_token: `eq.${token}`, limit: '1' });
  const foundResponse = await database(`orders?${params}`);
  if (!foundResponse.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات الطلب.' });
  const [order] = await foundResponse.json();
  if (!order) return response.status(404).json({ message: 'لم يتم العثور على الطلب.' });
  const portalSettingsResponse = await database('system_settings?select=renewal_store_url&singleton=eq.true&limit=1');
  const portalSettings = portalSettingsResponse.ok ? (await portalSettingsResponse.json())[0] || {} : {};
  const verifiedSession = deviceSession(request, order.id), deviceVerified = Boolean(verifiedSession);

  if (request.method === 'POST' && !deviceVerified) return response.status(403).json({ message: 'يجب التحقق من الجهاز قبل توثيق الإقرار.' });

  if (request.method === 'POST' && request.query?._route === 'reminder-email') {
    const email = String(request.body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return response.status(400).json({ message: 'أدخل بريدًا إلكترونيًا صالحًا.' });
    const subscribedAt = new Date().toISOString(), consentHash = createHmac('sha256', deviceSecret()).update(clientIp(request)).digest('hex');
    const saved = await database(`orders?id=eq.${encodeURIComponent(order.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ reminder_email: email, reminder_subscribed_at: subscribedAt, reminder_consent_ip_hash: consentHash, updated_at: subscribedAt }) });
    if (!saved.ok) return response.status(502).json({ message: 'تعذر حفظ بريد التذكير.' });
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    order.customer_name = customer?.name;order.customer_email = email;order.renewal_store_url = portalSettings.renewal_store_url || null;
    const daysRemaining = order.expires_at ? Math.ceil((new Date(order.expires_at) - Date.now()) / 86400000) : 0;
    try { await sendReminderConfirmation({ order, daysRemaining, baseUrl: process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://ok-phi-ten.vercel.app' }); }
    catch (error) { return response.status(502).json({ saved: true, message: 'تم حفظ البريد، لكن تعذر إرسال رسالة التأكيد حاليًا.' }); }
    return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ ok: true, emailMasked: maskEmail(email), subscribedAt });
  }

  if (request.method === 'POST' && !order.acknowledged_at) {
    if (request.body?.accepted !== true) return response.status(400).json({ message: 'يجب الموافقة على سياسة المنتج أولًا.' });
    const acknowledgedAt = new Date().toISOString();
    const update = await database(`orders?id=eq.${encodeURIComponent(order.id)}&acknowledged_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        acknowledged_at: acknowledgedAt,
        acknowledged_ip: clientIp(request),
        acknowledged_user_agent: String(request.headers['user-agent'] || '').slice(0, 500) || null,
        updated_at: acknowledgedAt,
      }),
    });
    if (!update.ok) return response.status(502).json({ message: 'تعذر توثيق الإقرار. حاول مجددًا.' });
    const [updated] = await update.json();
    order.acknowledged_at = updated?.acknowledged_at || acknowledgedAt;
  }

  const accountEmail = order.acknowledged_at && deviceVerified ? order.account_assignments?.[0]?.email_accounts?.mailbox_alias || null : null;
  if (accountEmail) await database('portal_activity_events', { method: 'POST', body: JSON.stringify({ order_id: order.id, activity_type: 'account_details_viewed', physical_core_hash: verifiedSession.physicalHash }) });
  delete order.id;
  delete order.account_assignments;
  delete order.customers;
  const reminderAddress = order.reminder_email || order.customer_email;
  order.reminder_email_masked = deviceVerified ? maskEmail(reminderAddress) : null;
  order.reminder_subscribed = Boolean(order.reminder_subscribed_at || order.customer_email);
  delete order.reminder_email;
  delete order.customer_email;
  delete order.tracking_token;
  order.account_email = accountEmail;
  order.device_verified = deviceVerified;
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({
    order,
    actions: {
      crunchyrollPortalUrl: deviceVerified && order.service_type === 'crunchyroll' ? publicUrl(process.env.PUBLIC_CRUNCHYROLL_PORTAL_URL) : null,
      supportWhatsapp: deviceVerified ? String(process.env.PUBLIC_SUPPORT_WHATSAPP || '').replace(/\D/g, '').slice(0, 20) || null : null,
      sallaReviewUrl: deviceVerified ? publicUrl(process.env.PUBLIC_SALLA_REVIEW_URL) : null,
      renewalStoreUrl: deviceVerified ? publicUrl(portalSettings.renewal_store_url) : null,
    },
  });
}

