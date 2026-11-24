const buckets = new Map();

function allowRequest(request, limit = 20, windowMs = 60_000) {
  const forwarded = String(request.headers["x-forwarded-for"] || "unknown");
  const ip = forwarded.split(",")[0].trim();
  const now = Date.now();
  const recent = (buckets.get(ip) || []).filter(time => now - time < windowMs);
  if (recent.length >= limit) {
    buckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  buckets.set(ip, recent);
  return true;
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ message: "الطريقة غير مسموحة." });
  if (!allowRequest(request)) {
    response.setHeader("Retry-After", "60");
    return response.status(429).json({ message: "تم تجاوز الحد المؤقت للاستعلامات. حاول بعد دقيقة." });
  }
  const query = String(request.query.q || "").trim();
  if (query.length < 4) return response.status(400).json({ message: "أدخل رقم طلب أو جوال صالح." });
  if (process.env.PUBLIC_LOOKUP_ENABLED !== "true" || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return response.status(503).json({ message: "خدمة الاستعلام قيد التهيئة." });
  }
  const byPhone = /^[0-9+]+$/.test(query) && query.length <= 15;
  const column = byPhone ? "customer_phone" : "order_number";
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = `${supabaseUrl}/rest/v1/orders?select=id,order_number,product_name,service_type,status,expires_at,warranty_expires_at,tracking_token&${column}=eq.${encodeURIComponent(query)}`;
  const supabase = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!supabase.ok) return response.status(502).json({ message: "تعذر تنفيذ الاستعلام." });
  let orders = await supabase.json();
  // A phone lookup cannot reveal the bearer-style tracking token of another order.
  if (byPhone) orders = orders.map(({ tracking_token, ...order }) => order);
  // Never use public/shared caching for order- or phone-derived results.
  response.setHeader("Cache-Control", "private, max-age=3, must-revalidate");
  response.setHeader("Vary", "X-Forwarded-For");
  return response.status(200).json({ orders });
}
