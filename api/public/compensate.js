import { createHmac, timingSafeEqual } from 'node:crypto';
import { reputationForOrder } from '../../lib/customer-reputation.js';
import { blockForMaintenance } from '../../lib/maintenance-mode.js';

const db = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const cleanToken = value => /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || '')) ? String(value) : '';
const secret = () => process.env.DEVICE_DNA_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
function verifiedDevice(request, orderId) {
  const cookie = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ap_device='));
  if (!cookie || !secret()) return null;
  const [cookieOrderId, physicalHash, expires, supplied] = decodeURIComponent(cookie.slice(10)).split('.');
  if (cookieOrderId !== orderId || !/^[a-f0-9]{64}$/.test(physicalHash) || Number(expires) <= Math.floor(Date.now() / 1000)) return null;
  const expected = createHmac('sha256', secret()).update(`${cookieOrderId}.${physicalHash}.${expires}`).digest('hex');
  return supplied?.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? physicalHash : null;
}

export default async function handler(request, response) {
  if (await blockForMaintenance(response)) return;
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  const token = cleanToken(request.query?.token || request.body?.token);
  if (!token || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return response.status(400).json({ message: 'رابط الطلب غير صالح.' });
  const orderResult = await db(`orders?select=id,store_id,order_number,customer_phone,customer_email,reminder_email,security_strikes,has_warranty,warranty_expires_at,status,customers(name)&tracking_token=eq.${encodeURIComponent(token)}&limit=1`);
  if (!orderResult.ok) return response.status(502).json({ message: 'تعذر التحقق من الطلب.' });
  const [order] = await orderResult.json();
  if (!order) return response.status(404).json({ message: 'الطلب غير موجود.' });
  if (!verifiedDevice(request, order.id)) return response.status(403).json({ message: 'لا يمكن طلب التعويض إلا من الجهاز الأصلي المعتمد.' });
  if (!order.has_warranty || !order.warranty_expires_at || new Date(order.warranty_expires_at) <= new Date()) return response.status(403).json({ message: 'الضمان غير سارٍ لهذا الطلب.' });
  const reason = String(request.body?.reason || '');
  if (!['password_changed', 'account_not_working', 'signed_out', 'other'].includes(reason)) return response.status(400).json({ message: 'اختر سبب المشكلة.' });
  const note = String(request.body?.note || '').trim().slice(0, 1000) || null;
  const [ordersResult, requestsResult, devicesResult] = await Promise.all([
    db(`orders?select=id,customer_phone,customer_email,reminder_email,security_strikes,customers(name)&store_id=eq.${encodeURIComponent(order.store_id)}&limit=1000`),
    db('compensation_requests?select=order_id,status,review_mode&limit=2000'),
    db('device_access_events?select=order_id,physical_core_hash&limit=5000'),
  ]);
  if (!ordersResult.ok || !requestsResult.ok || !devicesResult.ok) return response.status(502).json({ message: 'تعذر فحص سجل النزاهة التراكمي.' });
  const orders = await ordersResult.json(), requests = await requestsResult.json(), deviceEvents = await devicesResult.json();
  const reputation = reputationForOrder(order.id, orders, requests, deviceEvents);
  const previousAuto = requests.filter(item => item.order_id === order.id && item.review_mode === 'auto_approved' && item.status === 'approved').length;
  const autoEligible = Number(order.security_strikes || 0) === 0 && !reputation.requires_manual_compensation && previousAuto < 2;
  const createdResult = await db('compensation_requests', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    order_id: order.id, reason, customer_note: note,
    review_mode: autoEligible ? 'auto_approved' : 'manual_review',
    status: 'submitted', strikes_at_request: Number(order.security_strikes || 0),
    cumulative_strikes: reputation.cumulative_strikes,
    cumulative_orders: reputation.total_orders,
    cumulative_compensations: reputation.cumulative_compensations,
    reputation_badge: reputation.badge,
  }) });
  if (!createdResult.ok) return response.status(502).json({ message: 'تعذر تسجيل طلب التعويض.' });
  const [created] = await createdResult.json();
  if (!autoEligible) return response.status(202).json({ ok: true, status: 'manual_review', reputation });
  const replacement = await db('rpc/auto_replace_order_account', { method: 'POST', body: JSON.stringify({ p_request_id: created.id }) });
  if (!replacement.ok) return response.status(202).json({ ok: true, status: 'manual_review', reputation });
  const [decision] = await replacement.json();
  return response.status(decision?.approved ? 200 : 202).json({ ok: true, status: decision?.approved ? 'auto_approved' : 'manual_review', reason: decision?.reason, reputation });
}
