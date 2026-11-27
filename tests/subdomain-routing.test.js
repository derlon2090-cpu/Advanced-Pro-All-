import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blockAdminOutsideOfficialHost, isAdminHost, requestHost } from '../lib/host-routing.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const hostOf = route => route.has?.find(condition => condition.type === 'host')?.value;

test('official hosts route to isolated portal documents', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const expected = new Map([
    ['waleed.advpro.app', '/admin.html'],
    ['anime.advpro.app', '/crunchyroll.html'],
    ['gpt.advpro.app', '/chatgpt.html'],
    ['warranty.advpro.app', '/compensate.html'],
  ]);
  for (const [host, destination] of expected) {
    assert.ok(config.rewrites.some(route => hostOf(route) === host && route.destination === destination), `${host} must route to ${destination}`);
  }
  assert.ok(config.rewrites.some(route => route.source === '/' && hostOf(route) === 'advpro.app' && route.destination === '/home.html'));
  assert.ok(config.redirects.some(route => hostOf(route) === 'www.advpro.app' && route.statusCode === 301 && route.destination === 'https://advpro.app/:path*'));
});

test('legacy portal paths redirect permanently to their official subdomains', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const destinations = { crunchyroll: 'anime', chatgpt: 'gpt', compensate: 'warranty' };
  for (const [service, host] of Object.entries(destinations)) {
    assert.ok(config.redirects.some(route => route.source === `/${service}` && route.destination === `https://${host}.advpro.app/` && route.statusCode === 301));
    assert.ok(config.redirects.some(route => route.source === `/${service}/:path*` && route.destination === `https://${host}.advpro.app/:path*` && route.statusCode === 301));
  }
});

test('admin host isolation blocks official non-admin hosts and accepts forwarded host', () => {
  assert.equal(requestHost({ headers: { 'x-forwarded-host': 'waleed.advpro.app:443, proxy.local' } }), 'waleed.advpro.app');
  assert.equal(isAdminHost('waleed.advpro.app'), true);
  for (const host of ['advpro.app', 'www.advpro.app', 'anime.advpro.app', 'gpt.advpro.app', 'warranty.advpro.app', 'unknown.advpro.app']) {
    assert.equal(blockAdminOutsideOfficialHost({ headers: { host } }), true, host);
  }
  assert.equal(blockAdminOutsideOfficialHost({ headers: { host: 'waleed.advpro.app' } }), false);
  assert.equal(blockAdminOutsideOfficialHost({ headers: { host: 'localhost:3000' } }), false);
});

test('build emits host-specific pages and official environment defaults', async () => {
  const [home, admin, crunchyroll, chatgpt, compensate, env] = await Promise.all([
    read('public/home.html'), read('public/admin.html'), read('public/crunchyroll.html'),
    read('public/chatgpt.html'), read('public/compensate.html'), read('.env.example'),
  ]);
  assert.match(home, /singleOrderLookup/);
  assert.match(admin, /لوحة الإدارة/);
  assert.match(crunchyroll, /بوابة كرانشي رول/);
  assert.match(chatgpt, /بوابة تفعيل وإدارة اشتراك ChatGPT/);
  assert.match(compensate, /بوابة التعويض والاستبدال الفوري/);
  for (const line of [
    'APP_BASE_URL=https://advpro.app',
    'ADMIN_BASE_URL=https://waleed.advpro.app',
    'CR_PORTAL_URL=https://anime.advpro.app',
    'GPT_PORTAL_URL=https://gpt.advpro.app',
    'CLAIM_PORTAL_URL=https://warranty.advpro.app',
  ]) assert.ok(env.includes(line), line);
});

test('customer links use canonical referral and compensation hosts', async () => {
  const [trackApi, trackUi, crunchyroll, chatgpt] = await Promise.all([
    read('api/public/track.js'), read('ui/order-track.html'), read('ui/crunchyroll-portal.html'), read('ui/chatgpt-portal.html'),
  ]);
  assert.match(trackApi, /https:\/\/advpro\.app/);
  assert.match(trackUi, /https:\/\/warranty\.advpro\.app\//);
  assert.match(crunchyroll, /https:\/\/warranty\.advpro\.app\//);
  assert.match(chatgpt, /https:\/\/warranty\.advpro\.app\//);
});
