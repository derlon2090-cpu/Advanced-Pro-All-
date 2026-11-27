import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseDetailedDeviceInfo } from './device-info.js';
import { bindingError, createBinding, inspectBinding, setBindingCookie } from './device-binding.js';

const buckets = new Map();
const clientIp = request => String(request.headers['x-forwarded-for'] || request.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
const allowed = request => {
  const now = Date.now(), key = clientIp(request), recent = (buckets.get(key) || []).filter(time => now - time < 60_000);
  if (recent.length >= 30) return false;
  recent.push(now); buckets.set(key, recent); return true;
};
const config = () => ({ url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const db = (path, options = {}) => {
  const { url, key } = config();
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const cleanHash = value => /^[a-f0-9]{64}$/.test(String(value || '')) ? String(value) : null;
const cleanToken = value => /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || '')) ? String(value) : null;
const cleanSignals = value => {
  if (!value || typeof value !== 'object') return null;
  const keys = ['gpu', 'screen', 'platform', 'dpr', 'cores'], output = {};
  for (const key of keys) { const hash = cleanHash(value[key]); if (!hash) return null; output[key] = hash; }
  return output;
};
const matchScore = (known, current) => {
  if (!known || !current) return 0;
  const weights = { gpu: .3, screen: .25, platform: .25, dpr: .1, cores: .1 };
  return Object.entries(weights).reduce((score, [key, weight]) => score + (known[key] === current[key] ? weight : 0), 0);
};
const secret = () => process.env.DEVICE_DNA_SECRET || process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const issueChallenge = async token => {
  const nonce = randomBytes(24).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 60;
  const tokenHash = hash(token);
  const signature = createHmac('sha256', secret()).update(`${nonce}.${expires}.${tokenHash}`).digest('hex');
  const stored = await db('device_verification_nonces', {
    method: 'POST',
    body: JSON.stringify({ nonce_hash: hash(nonce), tracking_token_hash: tokenHash, expires_at: new Date(expires * 1000).toISOString() }),
  });
  return stored.ok ? { nonce, expires, signature } : null;
};
const consumeChallenge = async (token, challenge) => {
  const nonce = String(challenge?.nonce || ''), expires = Number(challenge?.expires), supplied = String(challenge?.signature || '');
  if (!/^[a-zA-Z0-9_-]{24,64}$/.test(nonce) || !Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000) || expires > Math.floor(Date.now() / 1000) + 65 || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const tokenHash = hash(token), expected = createHmac('sha256', secret()).update(`${nonce}.${expires}.${tokenHash}`).digest('hex');
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false;
  const params = new URLSearchParams({ nonce_hash: `eq.${hash(nonce)}`, tracking_token_hash: `eq.${tokenHash}`, used_at: 'is.null', expires_at: `gt.${new Date().toISOString()}` });
  const consumed = await db(`device_verification_nonces?${params}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: new Date().toISOString() }) });
  return consumed.ok && (await consumed.json()).length === 1;
};
const location = request => {
  const country = String(request.headers['x-vercel-ip-country'] || request.headers['cf-ipcountry'] || '').toUpperCase().slice(0, 8);
  let city = String(request.headers['x-vercel-ip-city'] || '').slice(0, 100);
  try { city = decodeURIComponent(city); } catch {}
  city = city.replace(/[<>\r\n]/g, '').trim();
  const cityHash = city && secret() ? createHmac('sha256', secret()).update(`${country}:${city.trim().toLowerCase()}`).digest('hex') : null;
  return { country, cityHash, cityName: city || null };
};
const sessionCookie = (orderId, physicalHash) => {
  const expires = Math.floor(Date.now() / 1000) + 1800;
  const payload = `${orderId}.${physicalHash}.${expires}`;
  const signature = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${signature}`;
};
const event = (orderId, dna, geo, decision, confidence) => db('device_access_events', {
  method: 'POST', body: JSON.stringify({ order_id: orderId, physical_core_hash: dna.physicalCoreDna, browser_dna_hash: dna.browserDna, device_name: dna.deviceName, city_hash: geo.cityHash, city_name: geo.cityName, country_code: geo.country || null, decision, confidence }),
});
const setSession = (response, orderId, physicalHash) => response.setHeader('Set-Cookie', `ap_device=${sessionCookie(orderId, physicalHash)}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Strict`);

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  if (!allowed(request)) return response.status(429).setHeader('Retry-After', '60').json({ message: 'طلبات كثيرة، حاول بعد دقيقة.' });
  const { url, key } = config();
  if (!url || !key || !secret()) return response.status(503).json({ message: 'التحقق الأمني غير متاح مؤقتًا.' });
  const token = cleanToken(request.body?.token), action = String(request.body?.action || 'verify');
  if (!token) return response.status(400).json({ message: 'رابط الطلب غير صالح.' });
  const params = new URLSearchParams({ select: 'id,status,locked_device_fingerprint_hash,locked_device_name,device_physical_signals,trusted_browser_hashes,free_resets_remaining,registered_city_hash,registered_country_code,device_last_seen_at,security_strikes,device_bind_token_hash,locked_browser_fingerprint_hash,locked_browser_family,locked_os_name', tracking_token: `eq.${token}`, limit: '1' });
  const found = await db(`orders?${params}`);
  if (!found.ok) return response.status(502).json({ message: 'تعذر التحقق من الجهاز.' });
  const [order] = await found.json();
  if (!order) return response.status(404).json({ message: 'رابط الطلب غير صالح.' });
  if (action === 'challenge') {
    const challenge = await issueChallenge(token);
    return challenge ? response.status(200).setHeader('Cache-Control', 'private, no-store').json({ challenge }) : response.status(502).json({ message: 'تعذر إنشاء التحدي الأمني.' });
  }
  const physicalCoreDna = cleanHash(request.body?.physicalCoreDna), browserDna = cleanHash(request.body?.browserDna), physicalSignals = cleanSignals(request.body?.physicalSignals);
  if (!physicalCoreDna || !browserDna || !physicalSignals) return response.status(400).json({ message: 'بيانات الجهاز غير مكتملة.' });
  if (!(await consumeChallenge(token, request.body?.challenge))) return response.status(409).json({ message: 'انتهى التحدي الأمني أو استُخدم سابقًا. أعد المحاولة.' });
  const detailed = parseDetailedDeviceInfo(request.headers['user-agent'], request.body?.clientHints || {});
  const dna = { physicalCoreDna, browserDna, physicalSignals, deviceName: String(detailed.label || request.body?.deviceName || 'جهاز جديد').replace(/[<>\r\n]/g, '').slice(0, 140) };
  const geo = location(request), now = new Date().toISOString();
  const issueBinding = async update => {
    const binding = createBinding();
    const saved = await db(`orders?id=eq.${order.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...update, device_bind_token_hash: binding.tokenHash, locked_browser_fingerprint_hash: browserDna, locked_browser_family: detailed.browser, locked_os_name: detailed.os || detailed.deviceType, updated_at: now }) });
    const rows = saved.ok ? await saved.json() : [];
    if (!rows.length) return null;
    setBindingCookie(request, response, order.id, binding.rawToken);
    return binding.rawToken;
  };

  if (order.status === 'suspended_security') {
    await event(order.id, dna, geo, 'blocked_existing_lock', 0);
    return response.status(403).json({ allowed: false, locked: true, state: 'security_review_required', securityStrikes: order.security_strikes });
  }

  if (!order.locked_device_fingerprint_hash) {
    const bindAnchor = await issueBinding({ locked_device_fingerprint_hash: physicalCoreDna, locked_device_name: dna.deviceName, device_physical_signals: physicalSignals, trusted_browser_hashes: [browserDna], registered_city_hash: geo.cityHash, registered_city_name: geo.cityName, registered_country_code: geo.country || null, device_last_seen_at: now });
    if (bindAnchor) { await event(order.id, dna, geo, 'registered_strict_browser', 1); return response.status(200).json({ allowed: true, state: 'registered', bindAnchor, freeResetsRemaining: order.free_resets_remaining }); }
    return response.status(409).json({ message: 'تم تسجيل جهاز آخر للتو. أعد المحاولة.' });
  }

  if (order.registered_country_code && geo.country && order.registered_country_code !== geo.country) {
    await event(order.id, dna, geo, 'blocked_geo_drift', 0);
    return bindingError(response, order, 'GEO_MISMATCH');
  }
  const exactHardware = order.locked_device_fingerprint_hash === physicalCoreDna;
  if (!exactHardware) { await event(order.id, dna, geo, 'blocked_strict_hardware', matchScore(order.device_physical_signals, physicalSignals)); return bindingError(response, order); }

  if (!order.device_bind_token_hash) {
    const knownBrowsers = Array.isArray(order.trusted_browser_hashes) ? order.trusted_browser_hashes : [];
    if (knownBrowsers.length && !knownBrowsers.includes(browserDna)) { await event(order.id, dna, geo, 'blocked_strict_browser_migration', 0); return bindingError(response, order); }
    const bindAnchor = await issueBinding({ device_physical_signals: physicalSignals, locked_device_name: dna.deviceName, trusted_browser_hashes: [browserDna], registered_country_code: order.registered_country_code || geo.country || null, registered_city_hash: order.registered_city_hash || geo.cityHash, registered_city_name: geo.cityName, device_last_seen_at: now });
    if (!bindAnchor) return response.status(502).json({ message: 'تعذر تثبيت ربط المتصفح.' });
    await event(order.id, dna, geo, 'strict_binding_migrated', 1);
    return response.status(200).json({ allowed: true, state: 'strict_binding_registered', bindAnchor, confidence: 1 });
  }

  if (order.locked_browser_fingerprint_hash !== browserDna) { await event(order.id, dna, geo, 'blocked_strict_browser', 0); return bindingError(response, order); }
  const binding = inspectBinding(request, order, { allowAnchorBootstrap: true });
  if (!binding.ok) { await event(order.id, dna, geo, 'blocked_missing_browser_binding', 0); return bindingError(response, order, binding.code); }
  await db(`orders?id=eq.${order.id}`, { method: 'PATCH', body: JSON.stringify({ device_last_seen_at: now, updated_at: now }) });
  await event(order.id, dna, geo, 'trusted_strict_browser', 1);
  return response.status(200).json({ allowed: true, state: 'trusted_strict_browser', bindAnchor: binding.needsAnchor ? binding.rawToken : undefined, confidence: 1, freeResetsRemaining: order.free_resets_remaining });

  /* Strict bindings are reset by an administrator only. Legacy fallback remains unreachable after migration. */
  if (order.free_resets_remaining <= 0) {
    const reason = 'different_device_after_reset';
    const strike = await db('rpc/record_confirmed_device_abuse', { method: 'POST', body: JSON.stringify({ p_order_id: order.id, p_reason: reason }) });
    const [security] = strike.ok ? await strike.json() : [{}];
    await event(order.id, dna, geo, 'blocked_confirmed', confidence);
    const suspended = Boolean(security?.suspended);
    return response.status(403).json({ allowed: false, locked: suspended, state: suspended ? 'security_review_required' : 'device_mismatch_strike', message: suspended ? 'تم إيقاف الوصول بعد مخالفتين مؤكدتين.' : 'الجهاز لا يطابق الجهاز المعتمد. سُجلت المخالفة الأولى دون قفل الطلب.', securityStrikes: security?.security_strikes ?? order.security_strikes });
  }

  if (request.body?.action === 'transfer') {
    const transfer = await db('rpc/claim_free_device_reset', { method: 'POST', body: JSON.stringify({ p_order_id: order.id, p_new_core_hash: physicalCoreDna, p_new_browser_hash: browserDna, p_new_device_name: dna.deviceName, p_new_signals: physicalSignals, p_city_hash: geo.cityHash, p_city_name: geo.cityName, p_country_code: geo.country }) });
    const [result] = transfer.ok ? await transfer.json() : [{}];
    if (!result?.success) return response.status(409).json({ message: 'تم استخدام فرصة النقل بالفعل.' });
    await event(order.id, dna, geo, 'self_transfer', 1);
    setSession(response, order.id, physicalCoreDna);
    return response.status(200).json({ allowed: true, transferred: true, state: 'self_transfer', freeResetsRemaining: result.remaining });
  }

  await event(order.id, dna, geo, 'transfer_offered', confidence);
  return response.status(409).json({ allowed: false, transferRequired: true, state: 'new_device', oldDeviceName: order.locked_device_name || 'جهازك السابق', freeResetsRemaining: order.free_resets_remaining, confidence });
}

