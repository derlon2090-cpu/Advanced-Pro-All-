import { createHmac, timingSafeEqual } from 'node:crypto';

const json = (response, status, body) => response.status(status).json(body);
const serviceFromProduct = name => /crunchyroll/i.test(name || '') ? 'crunchyroll' : /chatgpt|openai/i.test(name || '') ? 'chatgpt' : 'general_subscription';
const supabase = (path, options = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
  ...options,
  headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...(options.headers || {}) },
});
function signatureValid(request) {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  if (!secret) return false;
  const supplied = request.headers['x-salla-signature'] || request.headers['x-webhook-signature'] || '';
  const expected = createHmac('sha256', secret).update(JSON.stringify(request.body || {})).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json(response, 503, { error: 'Server is not configured' });
  if (!signatureValid(request)) return json(response, 401, { error: 'Invalid signature' });
  const payload = request.body || {}, event = request.headers['x-salla-event'] || payload.event || payload.type;
  if (!['order.created', 'order.updated'].includes(event)) return json(response, 202, { ignored: true });
  const order = payload.data || payload.order || payload;
  if (!['paid', 'completed'].includes(String(order.payment_status || order.status || '').toLowerCase())) return json(response, 202, { ignored: true, reason: 'order_not_paid' });
  const productName = order.items?.[0]?.name || order.product_name || order.product?.name || '';
  const args = {
    p_event_id: String(request.headers['x-salla-event-id'] || payload.event_id || payload.id || `${event}:${order.id}`),
    p_merchant_id: String(payload.merchant?.id || order.merchant_id || process.env.SALLA_MERCHANT_ID || ''),
    p_store_name: payload.merchant?.name || payload.store?.name || 'Salla', p_order_id: String(order.id),
    p_order_number: String(order.reference_id || order.number || order.id), p_customer_id: String(order.customer?.id || order.customer_id || 'unknown'),
    p_customer_name: order.customer?.name || '', p_customer_phone: order.customer?.mobile || order.customer?.phone || '',
    p_product_name: productName, p_service_type: serviceFromProduct(productName),
  };
  if (!args.p_merchant_id || !args.p_order_id) return json(response, 400, { error: 'Missing merchant or order identifier' });
  const ingest = await supabase('rpc/ingest_salla_paid_order', { method: 'POST', body: JSON.stringify(args) });
  if (!ingest.ok) return json(response, 502, { error: 'Order ingestion failed' });
  const orderId = await ingest.json();
  if (!orderId) return json(response, 200, { accepted: true, duplicate: true });
  const assigned = await supabase('rpc/assign_order_to_available_account', { method: 'POST', body: JSON.stringify({ p_order_id: orderId }) });
  if (!assigned.ok) return json(response, 502, { error: 'Assignment failed' });
  const [result] = await assigned.json();
  return json(response, 200, { accepted: true, assigned: Boolean(result?.assigned), pendingAssignment: !result?.assigned });
}
