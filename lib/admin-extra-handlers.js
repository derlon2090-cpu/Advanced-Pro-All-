import { sendOperationalEmail } from './operational-email.js';
import { upsertSallaProducts } from './salla-products.js';

const db = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const htmlEscape = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export async function handleAdminReview(request, response) {
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
    return (await result.json()).length ? response.status(200).json({ ok: true }) : response.status(404).json({ message: 'التقييم غير موجود.' });
  }
  return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
}

export async function handleAdminCompensation(request, response) {
  if (request.method !== 'PATCH') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  const id = /^[0-9a-f-]{36}$/i.test(String(request.query?.id || '')) ? String(request.query.id) : null, decision = String(request.body?.decision || ''), rejectionReason = String(request.body?.rejectionReason || '').trim().slice(0, 500);
  if (!id || !['approve', 'reject'].includes(decision)) return response.status(400).json({ message: 'بيانات القرار غير صالحة.' });
  if (decision === 'reject' && rejectionReason.length < 3) return response.status(400).json({ message: 'اكتب سبب الرفض لتسجيله وإظهاره للعميل.' });
  const result = await db('rpc/admin_resolve_compensation', { method: 'POST', body: JSON.stringify({ p_request_id: id, p_approve: decision === 'approve' }) });
  if (!result.ok) return response.status(502).json({ message: 'تعذر حفظ قرار التعويض.' });
  const [resolved] = await result.json();
  if (!resolved?.success) return response.status(409).json({ message: resolved?.reason === 'no_healthy_capacity' ? 'لا يوجد مقعد سليم متاح حاليًا.' : 'تعذر معالجة الطلب.' });
  if (decision === 'reject') await db(`compensation_requests?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ decision_reason: rejectionReason }) });
  const query = await db(`compensation_requests?select=customer_email,orders(order_number,tracking_token)&id=eq.${encodeURIComponent(id)}&limit=1`), [item] = query.ok ? await query.json() : [];
  if (item?.customer_email) {
    const order = Array.isArray(item.orders) ? item.orders[0] : item.orders, approved = decision === 'approve', portal = `${process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://advpro.app'}/track/${encodeURIComponent(order?.tracking_token || '')}`;
    await sendOperationalEmail({ to: item.customer_email, subject: approved ? `تم اعتماد تعويض الطلب #${order?.order_number}` : `تحديث طلب تعويض #${order?.order_number}`, html: `<div dir="rtl"><p>${approved ? 'تم اعتماد التعويض وتفعيل الحساب البديل.' : `تمت مراجعة الطلب ولم يُعتمد التعويض. السبب: ${htmlEscape(rejectionReason)}`}</p>${approved ? `<a href="${portal}">فتح بطاقة الاشتراك</a>` : ''}</div>`, text: approved ? `تم اعتماد التعويض. ${portal}` : `تمت مراجعة طلب التعويض ولم يُعتمد. السبب: ${rejectionReason}` }).catch(() => null);
  }
  return response.status(200).json(resolved);
}

export async function handleSallaProductSync(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  const token = process.env.SALLA_ACCESS_TOKEN;
  if (!token) return response.status(409).json({ message: 'أضف SALLA_ACCESS_TOKEN بصلاحية products.read أولًا.' });
  let page = 1, totalPages = 1, synced = 0;
  try {
    do {
      const url = new URL('https://api.salla.dev/admin/v2/products');
      url.searchParams.set('page', String(page)); url.searchParams.set('per_page', '100');
      const result = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }), payload = await result.json().catch(() => ({}));
      if (!result.ok) return response.status(result.status === 401 ? 401 : 502).json({ message: result.status === 401 ? 'رمز سلة غير صالح أو تنقصه صلاحية products.read.' : 'تعذر جلب المنتجات من سلة.' });
      synced += await upsertSallaProducts(db, Array.isArray(payload.data) ? payload.data : []);
      totalPages = Math.max(1, Math.min(Number(payload.pagination?.totalPages) || 1, 100)); page += 1;
    } while (page <= totalPages);
    return response.status(200).json({ ok: true, synced, pages: totalPages });
  } catch (error) { return response.status(502).json({ message: error.message || 'تعذر إكمال مزامنة منتجات سلة.' }); }
}
