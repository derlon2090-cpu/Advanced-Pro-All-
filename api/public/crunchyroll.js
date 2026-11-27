import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeOrderNumber } from '../../lib/order-number.js';
import { decryptSensitivePayload } from '../../lib/account-credentials.js';
import { blockForMaintenance } from '../../lib/maintenance-mode.js';
import { isCrunchyrollOrder, portalForOrder, wrongProductMessage } from '../../lib/service-product.js';

const buckets = new Map();
const clientIp = request => String(request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown').split(',')[0].trim().slice(0, 128);
const allowed = (request, limit) => {
  const now = Date.now(), key = `${clientIp(request)}:${request.query?._route || 'portal'}`;
  const recent = (buckets.get(key) || []).filter(time => now - time < 60_000);
  if (recent.length >= limit) { buckets.set(key, recent); return false; }
  recent.push(now); buckets.set(key, recent); return true;
};
const config = () => ({ url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const db = (path, options = {}) => {
  const { url, key } = config();
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const cleanToken = value => /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || '')) ? String(value) : null;
const secret = () => process.env.DEVICE_DNA_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const deviceSession = (request, orderId) => {
  const cookie = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('ap_device='));
  if (!cookie || !secret()) return null;
  const parts = decodeURIComponent(cookie.slice('ap_device='.length)).split('.');
  if (parts.length !== 4) return null;
  const [sessionOrderId, physicalHash, expires, supplied] = parts;
  if (sessionOrderId !== orderId || !/^[a-f0-9]{64}$/.test(physicalHash) || Number(expires) <= Math.floor(Date.now() / 1000)) return null;
  const expected = createHmac('sha256', secret()).update(`${sessionOrderId}.${physicalHash}.${expires}`).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? { physicalHash } : null;
};
const cleanText = (value, max = 800) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeApprovalUrl = value => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && /(^|\.)crunchyroll\.com$/i.test(url.hostname) ? url.toString() : null;
  } catch { return null; }
};

async function findOrderByToken(token) {
  const params = new URLSearchParams({
    select: 'id,order_number,product_name,service_type,payment_status,status,expires_at,acknowledged_at,tracking_token,account_assignments(email_account_id)',
    tracking_token: `eq.${token}`,
    limit: '1',
  });
  const result = await db(`orders?${params}`);
  return result.ok ? (await result.json())[0] || null : null;
}

async function handleAccess(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (!allowed(request, 12)) return response.status(429).setHeader('Retry-After', '60').json({ message: 'طلبات كثيرة، حاول بعد دقيقة.' });
  const orderNumber = normalizeOrderNumber(request.body?.orderNumber || request.body?.order_number);
  if (!/^\d{1,30}$/.test(orderNumber)) return response.status(400).json({ message: 'أدخل رقم الطلب بالأرقام فقط.' });
  const query = new URLSearchParams({
    select: 'tracking_token,product_name,service_type,payment_status,status,expires_at',
    or: `(order_number.eq.${orderNumber},order_number.eq.#${orderNumber})`,
    limit: '1',
  });
  const result = await db(`orders?${query}`);
  if (!result.ok) return response.status(502).json({ message: 'تعذر التحقق من الطلب حاليًا.' });
  const [order] = await result.json();
  if (!order) return response.status(404).json({ message: 'لم يتم العثور على هذا الطلب.' });
  if (!isCrunchyrollOrder(order)) return response.status(409).json({ message: wrongProductMessage(order, 'Crunchyroll'), redirectTo: portalForOrder(order) });
  if (String(order.payment_status).toLowerCase() !== 'paid') return response.status(403).json({ message: 'الطلب غير مدفوع أو لم يكتمل بعد.' });
  if (order.status === 'suspended_security') return response.status(403).json({ message: 'الوصول موقوف للمراجعة الأمنية. تواصل مع الدعم.' });
  if (order.expires_at && new Date(order.expires_at) <= new Date()) return response.status(410).json({ message: 'انتهت صلاحية هذا الاشتراك.' });
  if (!order.tracking_token) return response.status(409).json({ message: 'الطلب قيد التجهيز. حاول بعد قليل.' });
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ token: order.tracking_token, redirectTo: `/crunchyroll/${encodeURIComponent(order.tracking_token)}` });
}

async function handleMessages(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (!allowed(request, 18)) return response.status(429).setHeader('Retry-After', '10').json({ message: 'تم بلوغ حد التحديث المؤقت. انتظر قليلًا.' });
  const token = cleanToken(request.query?.token);
  if (!token) return response.status(400).json({ message: 'رابط الطلب غير صالح.' });
  const order = await findOrderByToken(token);
  if (!order) return response.status(404).json({ message: 'لم يتم العثور على اشتراك كرانشي رول.' });
  if (!isCrunchyrollOrder(order)) return response.status(409).json({ message: wrongProductMessage(order, 'Crunchyroll'), redirectTo: portalForOrder(order) });
  if (!order.acknowledged_at) return response.status(403).json({ message: 'يجب الموافقة على إقرار الضمان أولًا.' });
  if (!deviceSession(request, order.id)) return response.status(403).json({ message: 'انتهت جلسة الجهاز. أعد التحقق.' });
  if (order.expires_at && new Date(order.expires_at) <= new Date()) return response.status(410).json({ message: 'انتهت صلاحية الاشتراك.' });
  const assignment = order.account_assignments?.[0], accountId = assignment?.email_account_id;
  if (!accountId) return response.status(200).json({ messages: [], featured: null });
  const query = new URLSearchParams({ select: 'id,received_at,encrypted_payload', email_account_id: `eq.${accountId}`, expires_at: `gt.${new Date().toISOString()}`, order: 'received_at.desc', limit: '5' });
  const result = await db(`crunchyroll_mailbox_messages?${query}`);
  if (!result.ok) return response.status(502).json({ message: 'تعذر تحميل الرسائل.' });
  const messages = (await result.json()).map(row => {
    const payload = decryptSensitivePayload(row.encrypted_payload) || {};
    return {
      id: row.id,
      receivedAt: row.received_at,
      subject: cleanText(payload.subject, 180) || 'رسالة من Crunchyroll',
      snippet: cleanText(payload.snippet, 500),
      code: /^\d{4,8}$/.test(String(payload.code || '')) ? String(payload.code) : null,
      approvalUrl: safeApprovalUrl(payload.approvalUrl),
      deviceLabel: cleanText(payload.deviceLabel, 100) || null,
      device: cleanText(payload.device, 40) || null,
      browser: cleanText(payload.browser, 40) || null,
    };
  });
  const featuredMessage = messages.find(item => item.code || item.approvalUrl);
  const featured = featuredMessage ? { code: featuredMessage.code, approvalUrl: featuredMessage.approvalUrl, receivedAt: featuredMessage.receivedAt } : null;
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ messages, featured, serverTime: new Date().toISOString() });
}

export default async function handler(request, response) {
  if (await blockForMaintenance(response)) return;
  const { url, key } = config();
  if (!url || !key || !secret()) return response.status(503).json({ message: 'خدمة بوابة كرانشي رول غير متاحة مؤقتًا.' });
  return request.query?._route === 'messages' ? handleMessages(request, response) : handleAccess(request, response);
}
