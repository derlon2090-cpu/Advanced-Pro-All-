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
  const { orderNumber, order_number, salla_reference_id, phoneLast4, phone_last_4 } = request.body || {};
  const order = String(orderNumber || order_number || salla_reference_id || '')
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
  if (!/^\d{1,30}$/.test(order)) return response.status(400).json({ message: 'أدخل رقم الطلب بالأرقام فقط.' });
  const last4 = String(phoneLast4 || phone_last_4 || '')
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
  if (!/^\d{4}$/.test(last4)) return response.status(400).json({ message: 'أدخل آخر 4 أرقام من رقم الجوال.' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ message: 'خدمة الاستعلام غير متاحة مؤقتًا. يرجى المحاولة بعد قليل.' });
  const query = new URLSearchParams({ select: 'tracking_token,customer_phone', order_number: `eq.${order}`, limit: '5' });
  const result = await fetch(`${url}/rest/v1/orders?${query}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!result.ok) return response.status(502).json({ message: 'تعذر تنفيذ الاستعلام.' });
  const rows = await result.json();
  const found = rows.find(item => String(item.customer_phone || '').replace(/\D/g, '').slice(-4) === last4);
  if (!found || !found.tracking_token) return response.status(404).json({ message: 'لم يتم العثور على طلب مطابق للبيانات.' });
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ redirectTo: `/track/${encodeURIComponent(found.tracking_token)}` });
}
