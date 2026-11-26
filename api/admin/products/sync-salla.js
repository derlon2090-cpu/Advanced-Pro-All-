import { allowedAdmin, tokenFromRequest } from '../_auth.js';
import { upsertSallaProducts } from '../../../lib/salla-products.js';

const database = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
};

async function requireAdmin(request) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = tokenFromRequest(request);
  if (!url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY || !token) return false;
  const result = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${decodeURIComponent(token)}` } });
  const user = await result.json().catch(() => ({}));
  return result.ok && user.email && allowedAdmin(user.email);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (!(await requireAdmin(request))) return response.status(401).json({ message: 'جلسة غير صالحة.' });
  const token = process.env.SALLA_ACCESS_TOKEN;
  if (!token) return response.status(409).json({ message: 'أضف SALLA_ACCESS_TOKEN بصلاحية products.read أولًا.' });
  let page = 1, totalPages = 1, synced = 0;
  try {
    do {
      const url = new URL('https://api.salla.dev/admin/v2/products');
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', '100');
      const result = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok) return response.status(result.status === 401 ? 401 : 502).json({ message: result.status === 401 ? 'رمز سلة غير صالح أو تنقصه صلاحية products.read.' : 'تعذر جلب المنتجات من سلة.' });
      const products = Array.isArray(payload.data) ? payload.data : [];
      synced += await upsertSallaProducts(database, products);
      totalPages = Math.max(1, Math.min(Number(payload.pagination?.totalPages) || 1, 100));
      page += 1;
    } while (page <= totalPages);
    return response.status(200).json({ ok: true, synced, pages: totalPages });
  } catch (error) {
    return response.status(502).json({ message: error.message || 'تعذر إكمال مزامنة منتجات سلة.' });
  }
}
