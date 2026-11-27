import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(String(value || '')).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};
export const bindingCookieName = orderId => `ap_bind_${String(orderId || '').replace(/-/g, '').slice(0, 16)}`;
const cookieValue = (request, name) => {
  const item = String(request.headers?.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ''; }
};
export const bindingAnchor = request => String(request.headers?.['x-device-bind-anchor'] || request.body?.bindAnchor || '').trim();
export const inspectBinding = (request, order, { allowAnchorBootstrap = false } = {}) => {
  if (!Object.prototype.hasOwnProperty.call(order || {}, 'device_bind_token_hash')) return { legacy: true, ok: false };
  if (!order?.device_bind_token_hash) return { ok: false, code: 'DEVICE_BIND_REQUIRED' };
  const cookieToken = cookieValue(request, bindingCookieName(order.id));
  if (!cookieToken || !safeEqual(hash(cookieToken), order.device_bind_token_hash)) return { ok: false, code: 'DEVICE_MISMATCH' };
  const anchor = bindingAnchor(request);
  if (!anchor && !allowAnchorBootstrap) return { ok: false, code: 'DEVICE_BIND_ANCHOR_MISSING' };
  if (anchor && !safeEqual(hash(anchor), order.device_bind_token_hash)) return { ok: false, code: 'DEVICE_MISMATCH' };
  return { ok: true, needsAnchor: !anchor, rawToken: cookieToken };
};
const handoffLifetime = 90;
const handoffSecret = () => process.env.DEVICE_DNA_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const handoffSignature = (order, expires) => createHmac('sha256', handoffSecret())
  .update(JSON.stringify(['order-details', order.id, order.device_bind_token_hash, expires])).digest('hex');

export function issueDetailsHandoff(order) {
  const expires = Math.floor(Date.now() / 1000) + handoffLifetime;
  return expires + '.' + handoffSignature(order, expires);
}

export function inspectDetailsHandoff(request, order, proof) {
  const [, timestamp, signature] = /^(\d{1,12})\.([a-f0-9]{64})$/.exec(String(proof || '')) || [];
  const expires = Number(timestamp), now = Math.floor(Date.now() / 1000);
  const country = String(request.headers?.['x-vercel-ip-country'] || request.headers?.['cf-ipcountry'] || '').toUpperCase().slice(0, 8);
  if (!handoffSecret() || !timestamp || expires <= now || expires > now + handoffLifetime
    || order.status === 'suspended_security'
    || (order.registered_country_code && country && order.registered_country_code !== country)
    || !safeEqual(signature, handoffSignature(order, expires))) return { ok: false };
  return inspectBinding(request, order, { allowAnchorBootstrap: true });
}

export function detailsBinding(request, response, order) {
  const proof = request.method === 'GET' && request.headers?.['x-order-details-proof'];
  if (!proof) return inspectBinding(request, order);
  const result = inspectDetailsHandoff(request, order, proof);
  if (result.ok) response.setHeader('x-device-bind-anchor', result.rawToken);
  return { ...result, handoffRejected: !result.ok };
}
export const createBinding = () => {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hash(rawToken) };
};
export const setBindingCookie = (request, response, orderId, rawToken) => {
  const host = String(request.headers?.['x-forwarded-host'] || request.headers?.host || '').split(':')[0].toLowerCase();
  const domain = host === 'advpro.app' || host.endsWith('.advpro.app') ? '; Domain=.advpro.app' : '';
  response.setHeader('Set-Cookie', `${bindingCookieName(orderId)}=${encodeURIComponent(rawToken)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax${domain}`);
};
export const bindingError = (response, order, code = 'DEVICE_MISMATCH') => response.status(403).json({
  allowed: false,
  code,
  message: code === 'GEO_MISMATCH' ? 'تغيّرت دولة الاتصال. أوقف الـ VPN وافتح الاشتراك من نفس الدولة الموثّقة.' : 'هذا الاشتراك مربوط بمتصفح وجهاز آخر.',
  trustedDevice: order?.locked_device_name || [order?.locked_os_name, order?.locked_browser_family].filter(Boolean).join(' • ') || 'المتصفح والجهاز الموثّقان',
});
