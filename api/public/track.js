import { createHmac, timingSafeEqual } from 'node:crypto';
import activityHandler from '../../lib/activity-api.js';
import verifyDeviceHandler from '../../lib/verify-device-api.js';
import { sendReminderConfirmation } from '../../lib/renewal-email.js';
import { blockForMaintenance } from '../../lib/maintenance-mode.js';
import { decryptPassword } from '../../lib/account-credentials.js';
import { isCrunchyrollOrder } from '../../lib/service-product.js';
import { detailsBinding } from '../../lib/device-binding.js';

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
const portalUrl = value => /^\/[a-zA-Z0-9/_-]*$/.test(String(value || '')) ? String(value) : publicUrl(value);
const maskEmail = value => { const [name, domain] = String(value || '').split('@'); return name && domain ? `${name.slice(0, 1)}***@${domain}` : null; };

export default async function handler(request, response) {
  if (await blockForMaintenance(response)) return;
  if (request.query?._route === 'activity') return activityHandler(request, response);
  if (request.query?._route === 'verify-device') return verifyDeviceHandler(request, response);
  if (!['GET', 'POST'].includes(request.method)) return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (!allowed(request)) return response.status(429).setHeader('Retry-After', '60').json({ message: 'طلبات كثيرة، حاول بعد دقيقة.' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ message: 'خدمة الطلبات غير متاحة مؤقتًا.' });
  const token = cleanToken(request.query?.token || request.body?.token);
  if (!token) return response.status(400).json({ message: 'رابط الطلب غير صالح.' });

  if (request.method === 'GET' && request.query?.view === 'verification') {
    const query = new URLSearchParams({ select: 'order_number,product_name,service_type', tracking_token: 'eq.' + token, limit: '1' });
    const result = await database('orders?' + query);
    if (!result.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات الطلب.' });
    const [order] = await result.json();
    if (!order) return response.status(404).json({ message: 'لم يتم العثور على الطلب.' });
    return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ order });
  }

  const legacySelect = 'id,order_number,product_name,service_type,status,created_at,duration_days,starts_at,expires_at,has_warranty,warranty_days,warranty_expires_at,acknowledgment_text,acknowledged_at,tracking_token,customer_email,reminder_email,reminder_subscribed_at,renewal_url,renewal_discount_code,security_strikes,locked_device_name,locked_device_fingerprint_hash,customers(name),account_assignments(email_accounts(mailbox_alias,encrypted_connection))';
  const baseSelect = legacySelect.replace('locked_device_fingerprint_hash,','locked_device_fingerprint_hash,device_bind_token_hash,locked_browser_fingerprint_hash,locked_browser_family,locked_os_name,registered_country_code,');
  const select = baseSelect.replace('tracking_token,','tracking_token,referral_code,referral_coupon_unlocked_at,referral_assigned_coupon,');
  let params = new URLSearchParams({ select, tracking_token: `eq.${token}`, limit: '1' });
  let foundResponse = await database(`orders?${params}`);
  if(!foundResponse.ok){params=new URLSearchParams({select:legacySelect,tracking_token:`eq.${token}`,limit:'1'});foundResponse=await database(`orders?${params}`)}
  if (!foundResponse.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات الطلب.' });
  const [order] = await foundResponse.json();
  if (!order) return response.status(404).json({ message: 'لم يتم العثور على الطلب.' });
  const settingsSelect = 'renewal_store_url,salla_review_url,support_whatsapp,crunchyroll_portal_url,chatgpt_portal_url,upsell_enabled,upsell_title,upsell_description,upsell_url,upsell_duration_minutes,referral_coupon_enabled,referral_coupon_target,referral_coupon_code,referral_coupon_discount_label';
  let portalSettingsResponse = await database(`system_settings?select=${settingsSelect}&singleton=eq.true&limit=1`);
  if (!portalSettingsResponse.ok) portalSettingsResponse = await database('system_settings?select=renewal_store_url,salla_review_url,support_whatsapp,upsell_enabled,upsell_title,upsell_description,upsell_url,upsell_duration_minutes&singleton=eq.true&limit=1');
  const portalSettings = portalSettingsResponse.ok ? (await portalSettingsResponse.json())[0] || {} : {};
  const strictBinding = detailsBinding(request, response, order), verifiedSession = strictBinding.legacy ? deviceSession(request, order.id) : strictBinding.ok ? { physicalHash: order.locked_device_fingerprint_hash } : null, deviceVerified = Boolean(verifiedSession);

  if (strictBinding.handoffRejected) return response.status(403).setHeader('Cache-Control', 'private, no-store').json({ code:'DETAILS_HANDOFF_REJECTED' });
  if (request.method === 'POST' && !deviceVerified) return response.status(403).json({ message: 'يجب التحقق من الجهاز قبل توثيق الإقرار.' });

  if (request.method === 'POST' && request.query?._route === 'review') {
    if (!order.acknowledged_at) return response.status(403).json({ message: 'يجب توثيق استلام الطلب قبل إرسال التقييم.' });
    const rating = Number(request.body?.rating);
    const comment = String(request.body?.comment || '').trim().slice(0, 2000) || null;
    const suggestionCategory = String(request.body?.suggestionCategory || '').trim() || null;
    const suggestionText = String(request.body?.suggestionText || '').trim().slice(0, 2000) || null;
    const categories = new Set(['activation_speed', 'portal_ux', 'new_feature', 'support', 'other']);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return response.status(400).json({ message: 'اختر تقييمًا من نجمة إلى خمس نجوم.' });
    if ((suggestionCategory && !categories.has(suggestionCategory)) || Boolean(suggestionCategory) !== Boolean(suggestionText)) return response.status(400).json({ message: 'اختر تصنيف الاقتراح واكتب تفاصيله.' });
    const existingResponse = await database(`order_reviews?select=id,status&order_id=eq.${encodeURIComponent(order.id)}&limit=1`);
    if (!existingResponse.ok) return response.status(502).json({ message: 'تعذر التحقق من التقييم الحالي.' });
    const [existing] = await existingResponse.json();
    if (existing && existing.status !== 'pending') return response.status(409).json({ message: 'تمت مراجعة تقييم هذا الطلب ولا يمكن تعديله.' });
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    const review = { order_id: order.id, order_number: order.order_number, customer_name: customer?.name || null, product_name: order.product_name || 'منتج رقمي', rating, comment, suggestion_category: suggestionCategory, suggestion_text: suggestionText, status: 'pending' };
    const saved = await database(existing ? `order_reviews?id=eq.${encodeURIComponent(existing.id)}` : 'order_reviews', { method: existing ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(review) });
    if (!saved.ok) return response.status(502).json({ message: 'تعذر حفظ تقييمك حاليًا. حاول مرة أخرى.' });
    const sallaReviewUrl = publicUrl(process.env.PUBLIC_SALLA_REVIEW_URL || portalSettings.salla_review_url);
    const supportWhatsapp = String(process.env.PUBLIC_SUPPORT_WHATSAPP || portalSettings.support_whatsapp || '').replace(/\D/g, '').slice(0, 20) || null;
    return response.status(existing ? 200 : 201).setHeader('Cache-Control', 'private, no-store').json({ ok: true, rating, positive: rating >= 4, sallaReviewUrl: rating >= 4 ? sallaReviewUrl : null, supportWhatsapp: rating <= 3 ? supportWhatsapp : null });
  }
  if(request.method==='POST'&&request.query?._route==='review-share'){
    const sharedAt=new Date().toISOString(),saved=await database(`order_reviews?order_id=eq.${encodeURIComponent(order.id)}&rating=gte.4`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({salla_shared_at:sharedAt})});
    return saved.ok?response.status(200).json({ok:true,sharedAt}):response.status(404).json({message:'لم يتم العثور على تقييم إيجابي.'});
  }

  if (request.method === 'POST' && request.query?._route === 'reminder-email') {
    const email = String(request.body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return response.status(400).json({ message: 'أدخل بريدًا إلكترونيًا صالحًا.' });
    const subscribedAt = new Date().toISOString(), consentHash = createHmac('sha256', deviceSecret()).update(clientIp(request)).digest('hex');
    const saved = await database(`orders?id=eq.${encodeURIComponent(order.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ reminder_email: email, reminder_subscribed_at: subscribedAt, reminder_consent_ip_hash: consentHash, updated_at: subscribedAt }) });
    if (!saved.ok) return response.status(502).json({ message: 'تعذر حفظ بريد التذكير.' });
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
    order.customer_name = customer?.name;order.customer_email = email;order.renewal_store_url = portalSettings.renewal_store_url || null;
    const daysRemaining = order.expires_at ? Math.ceil((new Date(order.expires_at) - Date.now()) / 86400000) : 0;
    try { await sendReminderConfirmation({ order, daysRemaining, baseUrl: process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://advpro.app' }); }
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

  const assignedAccount=order.account_assignments?.[0]?.email_accounts;
  let reauthActive = !isCrunchyrollOrder(order);
  if (isCrunchyrollOrder(order) && deviceVerified && String(request.headers['x-reauth-window'] || '') === '1') {
    const active = await database(`service_reauth_sessions?select=id&order_id=eq.${encodeURIComponent(order.id)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&closed_at=is.null&order=started_at.desc&limit=1`);
    reauthActive = active.ok && (await active.json()).length > 0;
  }
  const credentialAccess = Boolean(order.acknowledged_at && deviceVerified && reauthActive);
  const accountEmail = credentialAccess ? assignedAccount?.mailbox_alias || null : null;
  const accountPassword = credentialAccess ? decryptPassword(assignedAccount?.encrypted_connection?.password) : null;
  const [reviewResponse, referralResponse] = await Promise.all([
    order.acknowledged_at && deviceVerified ? database(`order_reviews?select=status&order_id=eq.${encodeURIComponent(order.id)}&limit=1`) : null,
    deviceVerified ? database(`referral_rewards?select=id&referrer_order_id=eq.${encodeURIComponent(order.id)}&limit=100`) : null,
  ]);
  const [existingReview] = reviewResponse?.ok ? await reviewResponse.json() : [];
  const referralCount = referralResponse?.ok ? (await referralResponse.json()).length : 0;
  if (accountEmail) await database('portal_activity_events', { method: 'POST', body: JSON.stringify({ order_id: order.id, activity_type: 'account_details_viewed', physical_core_hash: verifiedSession.physicalHash }) });
  const trustedDevice = deviceVerified ? {
    name: String(order.locked_device_name || 'جهازك الحالي').replace(/[<>\r\n]/g, '').slice(0, 100),
    fingerprintId: `#${String(verifiedSession.physicalHash || order.locked_device_fingerprint_hash || '').slice(0, 4).toUpperCase()}…`,
    used: 1,
    limit: 1,
  } : null;
  delete order.id;
  delete order.account_assignments;
  delete order.customers;
  const reminderAddress = order.reminder_email || order.customer_email;
  order.reminder_email_masked = deviceVerified ? maskEmail(reminderAddress) : null;
  order.reminder_subscribed = Boolean(order.reminder_subscribed_at || order.customer_email);
  delete order.reminder_email;
  delete order.customer_email;
  delete order.tracking_token;
  delete order.locked_device_name;
  delete order.locked_device_fingerprint_hash;
  delete order.device_bind_token_hash;
  delete order.locked_browser_fingerprint_hash;
  delete order.locked_browser_family;
  delete order.locked_os_name;
  delete order.registered_country_code;
  order.account_email = accountEmail;
  order.account_password = accountPassword;
  order.device_verified = deviceVerified;
  order.reauth_required = isCrunchyrollOrder(order) && deviceVerified && !reauthActive;
  order.trusted_device = trustedDevice;
  const compensationAvailable = Boolean(deviceVerified && order.acknowledged_at && order.has_warranty && order.warranty_expires_at && new Date(order.warranty_expires_at) > new Date());
  const compensationEligible = compensationAvailable && Number(order.security_strikes || 0) === 0;
  const appBase=(process.env.APP_BASE_URL||process.env.PUBLIC_APP_URL||process.env.NEXT_PUBLIC_APP_URL||'https://advpro.app').replace(/\/$/,'');
  const referralUrl=deviceVerified&&order.referral_code?`${appBase}/?ref=${encodeURIComponent(order.referral_code)}`:null;
  const referralTarget=Math.min(Math.max(Number(portalSettings.referral_coupon_target)||5,1),100);
  const referralProgram=referralUrl?{url:referralUrl,count:referralCount,target:referralTarget,enabled:portalSettings.referral_coupon_enabled!==false,discountLabel:portalSettings.referral_coupon_discount_label||'خصم خاص 25% لعملائنا السفراء',coupon:order.referral_coupon_unlocked_at&&order.referral_assigned_coupon?order.referral_assigned_coupon:null,storeUrl:publicUrl(portalSettings.renewal_store_url)}:null;
  const offerMinutes=Math.min(Math.max(Number(portalSettings.upsell_duration_minutes)||30,1),1440),offerExpiresAt=order.acknowledged_at?new Date(new Date(order.acknowledged_at).getTime()+offerMinutes*60000):null;
  const upsellOffer=deviceVerified&&portalSettings.upsell_enabled&&offerExpiresAt>Date.now()&&publicUrl(portalSettings.upsell_url)?{title:portalSettings.upsell_title||'عرض خاص لعملائنا المميزين',description:portalSettings.upsell_description||'أضف منتجًا مكملًا بخصم حصري الآن',url:publicUrl(portalSettings.upsell_url),expiresAt:offerExpiresAt.toISOString()}:null;
  delete order.referral_code;
  delete order.security_strikes;
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({
    order,
    actions: {
      crunchyrollPortalUrl: deviceVerified && isCrunchyrollOrder(order) ? publicUrl(process.env.CR_PORTAL_URL || process.env.CRUNCHYROLL_PORTAL_URL || process.env.PUBLIC_CRUNCHYROLL_PORTAL_URL || portalSettings.crunchyroll_portal_url || 'https://anime.advpro.app') : null,
      chatgptPortalUrl: deviceVerified && order.service_type === 'chatgpt' ? portalUrl(process.env.GPT_PORTAL_URL || process.env.CHATGPT_PORTAL_URL || process.env.PUBLIC_CHATGPT_PORTAL_URL || portalSettings.chatgpt_portal_url || 'https://gpt.advpro.app') : null,
      supportWhatsapp: deviceVerified ? String(process.env.PUBLIC_SUPPORT_WHATSAPP || '').replace(/\D/g, '').slice(0, 20) || null : null,
      sallaReviewUrl: deviceVerified ? publicUrl(process.env.PUBLIC_SALLA_REVIEW_URL || portalSettings.salla_review_url) : null,
      renewalStoreUrl: deviceVerified ? publicUrl(portalSettings.renewal_store_url) : null,
      compensationEligible,
      compensationManualAvailable: compensationAvailable && !compensationEligible,
      referralUrl,
      referralProgram,
      upsellOffer,
    },
    review: existingReview ? { submitted: true, status: existingReview.status } : { submitted: false },
  });
}

