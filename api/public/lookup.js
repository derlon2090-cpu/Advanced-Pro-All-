import { createHmac, randomBytes } from 'node:crypto';
import { blockForMaintenance } from '../../lib/maintenance-mode.js';

const ip = request => String(request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown').split(',')[0].trim().slice(0, 128);
const normalizeOrder = value => String(value || '').trim().replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
const database = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const ipHash = request => createHmac('sha256', process.env.DEVICE_DNA_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY).update(ip(request)).digest('hex');

async function limitState(hash) {
  const result = await database(`public_lookup_limits?select=failed_attempts,blocked_until&ip_hash=eq.${hash}&limit=1`);
  if (!result.ok) return { failed_attempts: 0, blocked_until: null };
  return (await result.json())[0] || { failed_attempts: 0, blocked_until: null };
}
async function recordFailure(hash, current) {
  const failures = Number(current.failed_attempts || 0) + 1, blockedUntil = failures >= 6 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
  await database('public_lookup_limits?on_conflict=ip_hash', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ ip_hash: hash, failed_attempts: failures, blocked_until: blockedUntil, updated_at: new Date().toISOString() }) });
  return { failures, blockedUntil };
}
async function resetFailures(hash) {
  await database(`public_lookup_limits?ip_hash=eq.${hash}`, { method: 'PATCH', body: JSON.stringify({ failed_attempts: 0, blocked_until: null, updated_at: new Date().toISOString() }) });
}
const paidOrder = order => {
  const values = [order.payment_status, order.status?.slug, order.status?.name, order.status].map(value => String(value || '').toLowerCase());
  return values.some(value => /paid|completed|delivered|مدفوع|مكتمل|تم التنفيذ/.test(value));
};
const serviceFromProduct = name => /crunchyroll/i.test(name || '') ? 'crunchyroll' : /chatgpt|openai/i.test(name || '') ? 'chatgpt' : 'general_subscription';

async function importFromSalla(orderNumber) {
  const token = process.env.SALLA_ACCESS_TOKEN;
  if (!token) return null;
  const listUrl = new URL('https://api.salla.dev/admin/v2/orders');
  listUrl.searchParams.set('reference_id', orderNumber);listUrl.searchParams.set('per_page', '1');listUrl.searchParams.set('page', '1');
  const list = await fetch(listUrl, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (!list.ok) return null;
  const listed = (await list.json().catch(() => ({}))).data?.[0];
  if (!listed?.id) return null;
  const detailResponse = await fetch(`https://api.salla.dev/admin/v2/orders/${encodeURIComponent(listed.id)}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  const detail = detailResponse.ok ? (await detailResponse.json().catch(() => ({}))).data || listed : listed;
  if (!paidOrder(detail)) return null;
  const item = detail.items?.[0] || {}, productName = item.name || detail.product_name || 'اشتراك رقمي', productId = String(item.product?.id || item.product_id || item.id || item.sku || '');
  let mapping = null;
  if (productId) {
    const mappingResponse = await database(`salla_product_mappings?select=service_type,duration_days,has_warranty,warranty_days,acknowledgment_text,renewal_url,renewal_discount_code&salla_product_id=eq.${encodeURIComponent(productId)}&limit=1`);
    if (mappingResponse.ok) mapping = (await mappingResponse.json())[0] || null;
  }
  const fallbackDuration = /(?:2\s*month|شهرين|60\s*يوم)/i.test(productName) ? 60 : /(?:3\s*month|3\s*أشهر|90\s*يوم)/i.test(productName) ? 90 : 30;
  const customer = detail.customer || {}, args = {
    p_event_id: `salla-live:${listed.id}`, p_merchant_id: String(detail.merchant?.id || process.env.SALLA_MERCHANT_ID || ''), p_store_name: detail.merchant?.name || 'Salla',
    p_order_id: String(listed.id), p_order_number: String(detail.reference_id || listed.reference_id || orderNumber), p_customer_id: String(customer.id || 'unknown'), p_customer_name: customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(), p_customer_phone: customer.mobile || customer.phone || '',
    p_product_name: productName, p_service_type: mapping?.service_type || serviceFromProduct(productName), p_duration_days: mapping?.duration_days || fallbackDuration,
    p_has_warranty: mapping?.has_warranty !== false, p_warranty_days: mapping?.has_warranty === false ? 0 : mapping?.warranty_days || fallbackDuration, p_acknowledgment_text: mapping?.acknowledgment_text || null,
  };
  if (!args.p_merchant_id) return null;
  const ingest = await database('rpc/ingest_salla_paid_order', { method: 'POST', body: JSON.stringify(args) });
  if (!ingest.ok) return null;
  const orderId = await ingest.json();if (!orderId) return null;
  const email = String(customer.email || '').trim().toLowerCase();
  await database(`orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', body: JSON.stringify({ customer_email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null, tracking_token: randomBytes(24).toString('hex'), renewal_url: mapping?.renewal_url || null, renewal_discount_code: mapping?.renewal_discount_code || null, updated_at: new Date().toISOString() }) });
  await database('rpc/assign_order_to_available_account', { method: 'POST', body: JSON.stringify({ p_order_id: orderId }) });
  const found = await database(`orders?select=tracking_token&order_number=eq.${encodeURIComponent(orderNumber)}&limit=1`);
  return found.ok ? (await found.json())[0] || null : null;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (await blockForMaintenance(response)) return;
  const order = normalizeOrder(request.body?.orderNumber || request.body?.order_number || request.body?.salla_reference_id);
  if (!/^\d{1,30}$/.test(order)) return response.status(400).json({ message: 'أدخل رقم الطلب بالأرقام فقط.' });
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(503).json({ message: 'خدمة الاستعلام غير متاحة مؤقتًا.' });
  const hash = ipHash(request), state = await limitState(hash);
  if (state.blocked_until && new Date(state.blocked_until) > new Date()) {
    const seconds = Math.max(1, Math.ceil((new Date(state.blocked_until) - Date.now()) / 1000));
    return response.status(429).setHeader('Retry-After', String(seconds)).json({ message: 'تم إيقاف الاستعلام مؤقتًا بعد محاولات غير صحيحة متتالية. حاول بعد 15 دقيقة.' });
  }
  const query = new URLSearchParams({ select: 'tracking_token', order_number: `eq.${order}`, limit: '1' });
  let result = await database(`orders?${query}`), found = result.ok ? (await result.json())[0] : null;
  if (!found?.tracking_token) found = await importFromSalla(order).catch(() => null);
  if (!found?.tracking_token) {
    const failure = await recordFailure(hash, state);
    return response.status(404).json({ message: failure.blockedUntil ? 'لم يتم العثور على الطلب. تم إيقاف الاستعلام مؤقتًا لحماية العملاء.' : 'لم يتم العثور على هذا الطلب. تحقق من الرقم وحاول مجددًا.', attemptsRemaining: Math.max(0, 6 - failure.failures) });
  }
  await resetFailures(hash);
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ redirectTo: `/track/${encodeURIComponent(found.tracking_token)}` });
}
