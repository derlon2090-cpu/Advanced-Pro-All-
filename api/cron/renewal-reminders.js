import { renewalStage, sendRenewalEmail } from '../../lib/renewal-email.js';

const json = (response, status, body) => response.status(status).setHeader('Cache-Control', 'no-store').json(body);
const db = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.authorization !== `Bearer ${expected}`) return json(response, 401, { error: 'Unauthorized' });
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
    const daysRemaining = Math.max(0, Math.ceil((new Date(order.expires_at) - now) / 86400000));
    const stage = renewalStage(daysRemaining), stageDay = stage === '3d' ? 3 : stage === '1d' ? 1 : 0;
    if (!stages.includes(stageDay)) continue;
    const column = stage === '3d' ? 'renewal_reminder_3d_sent_at' : 'renewal_reminder_1d_sent_at';
    if (order[column]) { results.push({ orderNumber: order.order_number, stage, status: 'already_sent' }); continue; }
    try {
      order.customer_name = Array.isArray(order.customers) ? order.customers[0]?.name : order.customers?.name;
      order.customer_email = order.reminder_email || order.customer_email;
      order.renewal_store_url = settings.renewal_store_url || null;
      await sendRenewalEmail({ order, daysRemaining, baseUrl: process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://ok-phi-ten.vercel.app' });
      const sentAt = new Date().toISOString();
      const saved = await db(`orders?id=eq.${encodeURIComponent(order.id)}&${column}=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ [column]: sentAt, updated_at: sentAt }) });
      if (!saved.ok) throw new Error('Delivery state could not be saved');
      results.push({ orderNumber: order.order_number, stage, status: 'sent' });
    } catch (error) {
      results.push({ orderNumber: order.order_number, stage, status: 'failed', error: String(error.message || error).slice(0, 180) });
    }
  }
  return json(response, 200, { processed: orders.length, sent: results.filter(item => item.status === 'sent').length, failed: results.filter(item => item.status === 'failed').length, results });
}
