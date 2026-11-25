const ip = request => (request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
const buckets = new Map();
function allowed(request) {
  const key = ip(request), now = Date.now(), values = (buckets.get(key) || []).filter(time => now - time < 60_000);
  if (values.length >= 15) { buckets.set(key, values); return false; }
  values.push(now); buckets.set(key, values); return true;
}
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (!allowed(request)) return response.status(429).setHeader('Retry-After', '60').json({ message: 'تم تجاوز حد الاستعلامات. حاول بعد دقيقة.' });
  const { orderNumber, order_number, salla_reference_id } = request.body || {};
  const order = String(orderNumber || order_number || salla_reference_id || '').trim();
  if (!order) return response.status(400).json({ message: 'أدخل رقم الطلب في سلة.' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ message: 'خدمة الاستعلام قيد التهيئة.' });
  const query = new URLSearchParams({ select: 'tracking_token,status,security_strikes', order_number: `eq.${order}`, limit: '1' });
  const result = await fetch(`${url}/rest/v1/orders?${query}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!result.ok) return response.status(502).json({ message: 'تعذر تنفيذ الاستعلام.' });
  const [found] = await result.json();
  if (!found || !found.tracking_token) return response.status(404).json({ message: 'لم يتم العثور على طلب مطابق.' });
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ redirectTo: `/track/${encodeURIComponent(found.tracking_token)}` });
}
