import test from 'node:test';
import assert from 'node:assert/strict';
import verifyDevice from '../lib/verify-device-api.js';
import { inspectBinding } from '../lib/device-binding.js';

test('verification binds the first browser automatically and rejects another browser or device', async t => {
  const token = 'fixture-autobind-order-0001';
  const order = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'delivered', locked_device_fingerprint_hash: null, device_bind_token_hash: null, acknowledged_at: null };
  const usedNonces = new Set();
  let bindingWrites = 0;
  const previousUrl = process.env.SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://db.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-test-secret';
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret;
  });
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const requestUrl = new URL(url);
    const table = requestUrl.pathname.split('/').at(-1);
    const method = options.method || 'GET';
    if (table === 'orders' && method === 'GET') return Response.json([order]);
    if (table === 'orders' && method === 'PATCH') {
      const patch = JSON.parse(options.body);
      if (patch.device_bind_token_hash) {
        assert.equal(requestUrl.searchParams.get('locked_device_fingerprint_hash'), 'is.null');
        assert.equal(requestUrl.searchParams.get('device_bind_token_hash'), 'is.null');
        assert.equal(order.locked_device_fingerprint_hash, null);
        bindingWrites++;
      }
      Object.assign(order, patch);
      return Response.json([order]);
    }
    if (table === 'device_verification_nonces' && method === 'POST') return Response.json([]);
    if (table === 'device_verification_nonces' && method === 'PATCH') {
      const nonce = requestUrl.searchParams.get('nonce_hash');
      if (usedNonces.has(nonce)) return Response.json([]);
      usedNonces.add(nonce);
      return Response.json([{}]);
    }
    if (table === 'device_access_events') return Response.json([]);
    assert.fail('Unexpected test request '+url);
  });
  const request = async (body, cookie = '', host = 'advpro.app') => {
    const response = {
      headers: {},
      status(code) { this.code = code; return this; },
      setHeader(name, value) { this.headers[name] = value; return this; },
      json(data) { this.data = data; return this; },
    };
    return verifyDevice({ method: 'POST', body: { token, ...body }, headers: { host, cookie, 'x-forwarded-for': '192.0.2.12', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0' } }, response);
  };
  const physical = 'a'.repeat(64), browser = 'b'.repeat(64);
  const dna = { physicalCoreDna: physical, browserDna: browser, physicalSignals: Object.fromEntries(['gpu','screen','platform','dpr','cores'].map(key => [key, physical])) };
  const verify = async (signals, cookie = '', host = 'advpro.app') => {
    const challenge = await request({action:'challenge'}, cookie, host);
    assert.equal(challenge.code, 200);
    return request({ ...signals, action:'verify', challenge:challenge.data.challenge }, cookie, host);
  };

  const first = await verify(dna);
  assert.equal(first.code, 200);
  assert.equal(first.data.state, 'registered');
  assert.equal(order.locked_device_fingerprint_hash, physical);
  assert.ok(order.acknowledged_at);
  assert.match(first.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Lax; Domain=\.advpro\.app/);
  const cookie = first.headers['Set-Cookie'].split(';')[0];
  assert.equal(inspectBinding({headers:{cookie, 'x-device-bind-anchor':first.data.bindAnchor}}, order).ok, true);
  const recordedAt = order.acknowledged_at;

  const returning = await verify(dna, cookie, 'gpt.advpro.app');
  assert.equal(returning.code, 200);
  assert.equal(returning.data.state, 'trusted_strict_browser');
  assert.equal(returning.data.bindAnchor, first.data.bindAnchor);
  assert.equal(order.acknowledged_at, recordedAt);

  const secondBrowser = await verify(dna, '', 'anime.advpro.app');
  assert.equal(secondBrowser.code, 403);
  assert.equal(secondBrowser.data.code, 'DEVICE_MISMATCH');
  assert.equal(secondBrowser.data.trustedDevice, order.locked_device_name);
  assert.equal(secondBrowser.headers['Set-Cookie'], undefined);
  const secondDevice = await verify({ ...dna, physicalCoreDna:'d'.repeat(64) }, cookie, 'warranty.advpro.app');
  assert.equal(secondDevice.code, 403);
  assert.equal(secondDevice.data.code, 'DEVICE_MISMATCH');
  assert.equal(bindingWrites, 1);
  assert.equal((await request({ action:'transfer' })).code, 400);
});
