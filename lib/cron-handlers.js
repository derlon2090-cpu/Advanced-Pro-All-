import { renewalStage, sendRenewalEmail } from './renewal-email.js';
import { htmlEscape, sendOperationalEmail } from './operational-email.js';

const json = (response, status, body) => response.status(status).setHeader('Cache-Control', 'no-store').json(body);
const db = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const authorized = request => Boolean(process.env.CRON_SECRET && request.headers.authorization === `Bearer ${process.env.CRON_SECRET}`);

export async function renewalReminders(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
  if (!authorized(request)) return json(response, 401, { error: 'Unauthorized' });
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json(response, 503, { error: 'Server is not configured' });
  const settingsResponse = await db('system_settings?select=renewal_reminders_enabled,renewal_reminder_days,renewal_store_url&singleton=eq.true&limit=1');
  if (!settingsResponse.ok) return json(response, 502, { error: 'Settings query failed' });
  const [settings] = await settingsResponse.json();
  if (!settings?.renewal_reminders_enabled) return json(response, 200, { processed: 0, sent: 0, skipped: true, reason: 'disabled' });
  const stages = Array.isArray(settings.renewal_reminder_days) ? settings.renewal_reminder_days.map(Number).filter(day => day === 3 || day === 1) : [3, 1];
  const maxDays = Math.max(...stages, 1), now = new Date(), end = new Date(now.getTime() + (maxDays + 1) * 86400000);
  const params = new URLSearchParams({ select: 'id,order_number,product_name,customer_email,reminder_email,expires_at,tracking_token,renewal_url,renewal_discount_code,renewal_reminder_3d_sent_at,renewal_reminder_1d_sent_at,customers(name)', status: 'eq.delivered', or: '(customer_email.not.is.null,reminder_email.not.is.null)', expires_at: `gte.${now.toISOString()}` });
  params.append('expires_at', `lt.${end.toISOString()}`);
  const ordersResponse = await db(`orders?${params}`);
  if (!ordersResponse.ok) return json(response, 502, { error: 'Renewal query failed' });
  const orders = await ordersResponse.json(), results = [];
  for (const order of orders) {
    const daysRemaining = Math.max(0, Math.ceil((new Date(order.expires_at) - now) / 86400000)), stage = renewalStage(daysRemaining), stageDay = stage === '3d' ? 3 : stage === '1d' ? 1 : 0;
    if (!stages.includes(stageDay)) continue;
    const column = stage === '3d' ? 'renewal_reminder_3d_sent_at' : 'renewal_reminder_1d_sent_at';
    if (order[column]) { results.push({ orderNumber: order.order_number, stage, status: 'already_sent' }); continue; }
    try {
      order.customer_name = Array.isArray(order.customers) ? order.customers[0]?.name : order.customers?.name; order.customer_email = order.reminder_email || order.customer_email; order.renewal_store_url = settings.renewal_store_url || null;
      await sendRenewalEmail({ order, daysRemaining, baseUrl: process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://ok-phi-ten.vercel.app' });
      const sentAt = new Date().toISOString(), saved = await db(`orders?id=eq.${encodeURIComponent(order.id)}&${column}=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ [column]: sentAt, updated_at: sentAt }) });
      if (!saved.ok) throw new Error('Delivery state could not be saved');
      results.push({ orderNumber: order.order_number, stage, status: 'sent' });
    } catch (error) { results.push({ orderNumber: order.order_number, stage, status: 'failed', error: String(error.message || error).slice(0, 180) }); }
  }
  return json(response, 200, { processed: orders.length, sent: results.filter(item => item.status === 'sent').length, failed: results.filter(item => item.status === 'failed').length, results });
}

export async function mailRetention(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ error: 'Server is not configured' });
  const options = { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' };
  const [mail, nonces] = await Promise.all([fetch(`${url}/rest/v1/rpc/cleanup_expired_mail_metadata`, options), fetch(`${url}/rest/v1/rpc/cleanup_expired_device_nonces`, options)]);
  return mail.ok && nonces.ok ? response.status(200).json({ cleanedMail: await mail.json(), cleanedDeviceNonces: await nonces.json() }) : response.status(502).json({ error: 'Cleanup failed' });
}

export async function dailyDigest(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  if (!authorized(request)) return response.status(401).json({ error: 'Unauthorized' });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), start = new Date(`${today}T00:00:00+03:00`).toISOString();
  const [settings, orders, events, reviews] = await Promise.all([db('system_settings?select=digest_email&singleton=eq.true&limit=1'), db(`orders?select=id,status,security_strikes,created_at,renewal_reminder_3d_sent_at,renewal_reminder_1d_sent_at,renewal_reminder_manual_sent_at&updated_at=gte.${encodeURIComponent(start)}`), db(`mail_security_events?select=id,event_type,received_at&received_at=gte.${encodeURIComponent(start)}`), db(`order_reviews?select=id&status=eq.pending&created_at=gte.${encodeURIComponent(start)}`)]);
  const [config] = settings.ok ? await settings.json() : [], orderRows = orders.ok ? await orders.json() : [], eventRows = events.ok ? await events.json() : [], reviewRows = reviews.ok ? await reviews.json() : [];
  const sentToday = value => value && new Date(value) >= new Date(start), delivered = orderRows.filter(order => order.status === 'delivered').length, reminders = orderRows.reduce((count, order) => count + [order.renewal_reminder_3d_sent_at, order.renewal_reminder_1d_sent_at, order.renewal_reminder_manual_sent_at].filter(sentToday).length, 0), strikes = orderRows.reduce((count, order) => count + Number(order.security_strikes || 0), 0), securityTotal = eventRows.length + strikes, to = config?.digest_email || process.env.EXECUTIVE_DIGEST_EMAIL;
  if (!to) return response.status(200).json({ skipped: true, reason: 'no_destination' });
  const text = `ملخص ${today}: ${delivered} طلبات منفذة، ${reminders} تذكيرات، ${securityTotal} تنبيهات/مخالفات أمنية، ${reviewRows.length} تقييمات جديدة بانتظار الاعتماد.`;
  await sendOperationalEmail({ to, subject: `الملخص التنفيذي اليومي — ${today}`, html: `<div dir="rtl"><h2>الملخص التنفيذي اليومي</h2><p>${htmlEscape(text)}</p><ul><li>الطلبات المنفذة: <strong>${delivered}</strong></li><li>التذكيرات المرسلة: <strong>${reminders}</strong></li><li>التنبيهات والمخالفات الأمنية: <strong>${securityTotal}</strong></li><li>التقييمات الجديدة المعلقة: <strong>${reviewRows.length}</strong></li></ul></div>`, text });
  return response.status(200).json({ sent: true, delivered, reminders, securityAlerts: securityTotal, pendingReviews: reviewRows.length });
}
