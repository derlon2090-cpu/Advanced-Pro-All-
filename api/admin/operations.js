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
    const [capacity, rotations, mappings, settings] = await Promise.all([
      db('admin_capacity_radar?select=*'), db('admin_password_rotation_queue?select=*'),
      db('salla_product_mappings?select=*&order=created_at.desc'), db('system_settings?select=*&singleton=eq.true'),
    ]);
    if (!capacity.ok || !rotations.ok || !mappings.ok || !settings.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات التشغيل.' });
    return response.status(200).json({ capacity: await capacity.json(), rotations: await rotations.json(), mappings: await mappings.json(), settings: (await settings.json())[0] || {} });
  }
  if (request.method === 'POST') {
    const { action, emailAccountId, mapping, settings } = request.body || {};
    let result;
    if (action === 'save_mapping') {
      if (!mapping?.salla_product_id || !mapping?.service_type) return response.status(400).json({ message: 'رقم المنتج والخدمة مطلوبان.' });
      result = await db('salla_product_mappings?on_conflict=salla_product_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ salla_product_id: String(mapping.salla_product_id), product_title: mapping.product_title || null, service_type: mapping.service_type, duration_days: Number(mapping.duration_days) || 30, updated_at: new Date().toISOString() }) });
    } else if (action === 'save_settings') {
      result = await db('system_settings?singleton=eq.true', { method: 'PATCH', body: JSON.stringify({ banner_active: Boolean(settings?.banner_active), banner_message: settings?.banner_message || null, auto_assignment_paused: Boolean(settings?.auto_assignment_paused), updated_at: new Date().toISOString() }) });
    } else {
      if (!emailAccountId) return response.status(400).json({ message: 'معرّف الحساب مطلوب.' });
      result = await db('rpc/confirm_password_rotation', { method: 'POST', body: JSON.stringify({ p_email_account_id: emailAccountId }) });
    }
    return result.ok ? response.status(204).end() : response.status(502).json({ message: 'تعذر تأكيد التحديث.' });
  }
  return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
}
