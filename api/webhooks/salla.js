import { createHmac, timingSafeEqual } from 'node:crypto';

const json = (response, status, body) => response.status(status).json(body);
const serviceFromProduct = name => /crunchyroll/i.test(name || '') ? 'crunchyroll' : /chatgpt|openai/i.test(name || '') ? 'chatgpt' : 'general_subscription';
const supabaseUrl = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabase = (path, options = {}) => fetch(`${supabaseUrl()}/rest/v1/${path}`, {
  ...options,
  headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...(options.headers || {}) },
});
async function productMapping(productId) {
  if (!productId) return null;
  const params = new URLSearchParams({ select: 'service_type,duration_days,has_warranty,warranty_days,acknowledgment_text', salla_product_id: `eq.${productId}`, limit: '1' });
  const response = await supabase(`salla_product_mappings?${params}`);
  if (!response.ok) return null;
  return (await response.json())[0] || null;
}
async function assignmentPaused() {
  const response = await supabase('system_settings?select=auto_assignment_paused&singleton=eq.true&limit=1');
  if (!response.ok) return false;
  return Boolean((await response.json())[0]?.auto_assignment_paused);
}
async function sendWhatsApp({ phone, orderNumber, trackingToken }) {
  if (!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_API_TOKEN || !phone || !trackingToken) return false;
  const message = `أهلاً بك في بوابة أدفانسد برو ✨\nرقم طلبك: ${orderNumber}\nرابط المتابعة: https://advsub.store/track/${trackingToken}\nتنبيه: الاشتراك مخصص لجهاز واحد.`;
  const response = await fetch(process.env.WHATSAPP_API_URL, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ to: phone, message }),
  });
  return response.ok;
}
function signatureValid(request) {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  if (!secret) return false;
  const supplied = request.headers['x-salla-signature'] || request.headers['x-webhook-signature'] || '';
  const expected = createHmac('sha256', secret).update(JSON.stringify(request.body || {})).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
  if (!supabaseUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json(response, 503, { error: 'Server is not configured' });
  if (!signatureValid(request)) return json(response, 401, { error: 'Invalid signature' });
  const payload = request.body || {}, event = request.headers['x-salla-event'] || payload.event || payload.type;
  if (!['order.created', 'order.updated'].includes(event)) return json(response, 202, { ignored: true });
  const order = payload.data || payload.order || payload;
  if (!['paid', 'completed'].includes(String(order.payment_status || order.status || '').toLowerCase())) return json(response, 202, { ignored: true, reason: 'order_not_paid' });
  const item = order.items?.[0] || order.product || {};
  const productName = item.name || order.product_name || '';
  const productId = String(item.id || item.product_id || item.sku || order.product_id || order.sku || '');
  const mapping = await productMapping(productId);
  const fallbackDuration = /(?:2\s*month|شهرين|60\s*يوم)/i.test(productName) ? 60 : /(?:3\s*month|3\s*أشهر|90\s*يوم)/i.test(productName) ? 90 : 30;
  const args = {
    p_event_id: String(request.headers['x-salla-event-id'] || payload.event_id || payload.id || `${event}:${order.id}`),
    p_merchant_id: String(payload.merchant?.id || order.merchant_id || process.env.SALLA_MERCHANT_ID || ''),
    p_store_name: payload.merchant?.name || payload.store?.name || 'Salla', p_order_id: String(order.id),
    p_order_number: String(order.reference_id || order.number || order.id), p_customer_id: String(order.customer?.id || order.customer_id || 'unknown'),
    p_customer_name: order.customer?.name || '', p_customer_phone: order.customer?.mobile || order.customer?.phone || '',
    p_product_name: productName, p_service_type: mapping?.service_type || serviceFromProduct(productName),
    p_duration_days: mapping?.duration_days || fallbackDuration,
    p_has_warranty: mapping?.has_warranty !== false,
    p_warranty_days: mapping?.has_warranty === false ? 0 : (mapping?.warranty_days || mapping?.duration_days || fallbackDuration),
    p_acknowledgment_text: mapping?.acknowledgment_text || null,
  };
  if (!args.p_merchant_id || !args.p_order_id) return json(response, 400, { error: 'Missing merchant or order identifier' });
  const ingest = await supabase('rpc/ingest_salla_paid_order', { method: 'POST', body: JSON.stringify(args) });
  if (!ingest.ok) return json(response, 502, { error: 'Order ingestion failed' });
  const orderId = await ingest.json();
  if (!orderId) return json(response, 200, { accepted: true, duplicate: true });
  if (await assignmentPaused()) return json(response, 200, { accepted: true, assigned: false, pendingAssignment: true, paused: true });
  const assigned = await supabase('rpc/assign_order_to_available_account', { method: 'POST', body: JSON.stringify({ p_order_id: orderId }) });
  if (!assigned.ok) return json(response, 502, { error: 'Assignment failed' });
  const [result] = await assigned.json();
  const wasAssigned = Boolean(result?.assigned);
  const whatsappSent = wasAssigned ? await sendWhatsApp({ phone: args.p_customer_phone, orderNumber: args.p_order_number, trackingToken: result?.tracking_token }) : false;
  return json(response, 200, { accepted: true, assigned: wasAssigned, pendingAssignment: !wasAssigned, productMappingUsed: Boolean(mapping), whatsappSent });
}
