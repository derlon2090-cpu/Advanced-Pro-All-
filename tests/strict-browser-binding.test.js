import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bindingCookieName, inspectBinding } from '../lib/device-binding.js';
import { readFile } from 'node:fs/promises';

const hash = value => createHash('sha256').update(value).digest('hex');
const order = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  device_bind_token_hash: hash('trusted-secret'),
};
const request = (cookie = '', anchor = '') => ({ headers: { cookie, 'x-device-bind-anchor': anchor } });

test('strict binding rejects another browser or incognito session without leaking access', () => {
  const result = inspectBinding(request(), order);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DEVICE_MISMATCH');
  assert.equal('rawToken' in result, false);
});

test('strict binding requires both HttpOnly cookie and IndexedDB anchor', () => {
  const name = bindingCookieName(order.id);
  assert.equal(inspectBinding(request(`${name}=trusted-secret`), order).code, 'DEVICE_BIND_ANCHOR_MISSING');
  assert.equal(inspectBinding(request('', 'trusted-secret'), order).code, 'DEVICE_MISMATCH');
  assert.equal(inspectBinding(request(`${name}=trusted-secret`, 'wrong-anchor'), order).code, 'DEVICE_MISMATCH');
  assert.equal(inspectBinding(request(`${name}=trusted-secret`, 'trusted-secret'), order).ok, true);
});

test('cross-subdomain bootstrap only restores the client anchor from a valid parent-domain cookie', () => {
  const name = bindingCookieName(order.id);
  const result = inspectBinding(request(`${name}=trusted-secret`), order, { allowAnchorBootstrap: true });
  assert.equal(result.ok, true);
  assert.equal(result.needsAnchor, true);
  assert.equal(result.rawToken, 'trusted-secret');
});

test('credentials and approval endpoints are guarded by strict binding and re-auth windows', async () => {
  const [track, crunchy, chatgpt, migration] = await Promise.all([
    readFile(new URL('../api/public/track.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/public/crunchyroll.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/public/chatgpt.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/029_strict_browser_binding_and_reauth.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(track, /detailsBinding/);
  assert.match(track, /x-reauth-window/);
  assert.match(crunchy, /handleStartReauth/);
  assert.match(crunchy, /service_reauth_sessions/);
  assert.match(chatgpt, /inspectBinding/);
  assert.match(migration, /device_bind_token_hash/);
  assert.match(migration, /strict_browser_device_reset/);
});
