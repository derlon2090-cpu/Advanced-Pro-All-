import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
