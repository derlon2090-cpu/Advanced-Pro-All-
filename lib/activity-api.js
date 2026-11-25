import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = () => process.env.DEVICE_DNA_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const config = () => ({ url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const db = (path, options = {}) => {
  const { url, key } = config();
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const cleanToken = value => /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || '')) ? String(value) : null;
const session = (request, orderId) => {
  const cookie = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ap_device='));
  if (!cookie || !secret()) return null;
  const parts = decodeURIComponent(cookie.slice('ap_device='.length)).split('.');
  if (parts.length !== 4) return null;
  const [sessionOrderId, physicalHash, expires, supplied] = parts;
  if (sessionOrderId !== orderId || !/^[a-f0-9]{64}$/.test(physicalHash) || Number(expires) <= Math.floor(Date.now() / 1000)) return null;
  const expected = createHmac('sha256', secret()).update(`${sessionOrderId}.${physicalHash}.${expires}`).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? { physicalHash } : null;
};

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  const { url, key } = config(), token = cleanToken(request.body?.token), activity = String(request.body?.activity || '');
  if (!url || !key || !token || !['account_email_copied'].includes(activity)) return response.status(400).json({ message: 'طلب غير صالح.' });
  const query = new URLSearchParams({ select: 'id', tracking_token: `eq.${token}`, limit: '1' });
  const found = await db(`orders?${query}`);
  if (!found.ok) return response.status(502).json({ message: 'تعذر تسجيل النشاط.' });
  const [order] = await found.json();
  if (!order) return response.status(404).json({ message: 'الطلب غير موجود.' });
  const verified = session(request, order.id);
  if (!verified) return response.status(403).json({ message: 'جلسة الجهاز غير صالحة.' });
  const result = await db('portal_activity_events', { method: 'POST', body: JSON.stringify({ order_id: order.id, activity_type: activity, physical_core_hash: verified.physicalHash }) });
  return result.ok ? response.status(204).end() : response.status(502).json({ message: 'تعذر تسجيل النشاط.' });
}

