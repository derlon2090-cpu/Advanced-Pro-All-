import { allowedAdmin, tokenFromRequest } from './_auth.js';

async function requireAdmin(request) {
  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, token = tokenFromRequest(request);
  if (!url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY || !token) return false;
  const result = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${decodeURIComponent(token)}` } });
  const user = await result.json().catch(() => ({}));
  return result.ok && user.email && allowedAdmin(user.email);
}
async function db(path, options = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
}

export default async function handler(request, response) {
  if (!(await requireAdmin(request))) return response.status(401).json({ message: 'جلسة غير صالحة.' });
  if (request.method === 'GET') {
    const [capacity, rotations] = await Promise.all([db('admin_capacity_radar?select=*'), db('admin_password_rotation_queue?select=*')]);
    if (!capacity.ok || !rotations.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات التشغيل.' });
    return response.status(200).json({ capacity: await capacity.json(), rotations: await rotations.json() });
  }
  if (request.method === 'POST') {
    const { emailAccountId } = request.body || {};
    if (!emailAccountId) return response.status(400).json({ message: 'معرّف الحساب مطلوب.' });
    const result = await db('rpc/confirm_password_rotation', { method: 'POST', body: JSON.stringify({ p_email_account_id: emailAccountId }) });
    return result.ok ? response.status(204).end() : response.status(502).json({ message: 'تعذر تأكيد التحديث.' });
  }
  return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
}
