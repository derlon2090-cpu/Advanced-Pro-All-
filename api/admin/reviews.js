import { allowedAdmin, tokenFromRequest } from './_auth.js';

const db = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
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
  if (!(await requireAdmin(request))) return response.status(401).json({ message: 'جلسة غير صالحة.' });
  const id = /^[0-9a-f-]{36}$/i.test(String(request.query?.id || '')) ? String(request.query.id) : null;
  if (!id) return response.status(400).json({ message: 'معرّف التقييم غير صالح.' });
  if (request.method === 'PATCH') {
    const status = String(request.body?.status || '');
    if (!['published', 'hidden'].includes(status)) return response.status(400).json({ message: 'حالة المراجعة غير صالحة.' });
    const result = await db(`order_reviews?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, reviewed_at: new Date().toISOString() }) });
    if (!result.ok) return response.status(502).json({ message: 'تعذر تحديث التقييم.' });
    const rows = await result.json();
    return rows.length ? response.status(200).json({ review: rows[0] }) : response.status(404).json({ message: 'التقييم غير موجود.' });
  }
  if (request.method === 'DELETE') {
    const result = await db(`order_reviews?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    if (!result.ok) return response.status(502).json({ message: 'تعذر حذف التقييم.' });
    const rows = await result.json();
    return rows.length ? response.status(200).json({ ok: true }) : response.status(404).json({ message: 'التقييم غير موجود.' });
  }
  return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
}
