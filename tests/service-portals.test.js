import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isChatgptOrder, isCrunchyrollOrder, portalForOrder, wrongProductMessage } from '../lib/service-product.js';

test('strict service isolation rejects a mislabeled Gemini order', () => {
  const mislabeled = { service_type: 'crunchyroll', product_name: 'Google Gemini – رابط تفعيل عرض 18 شهرًا' };
  assert.equal(isCrunchyrollOrder(mislabeled), false);
  assert.equal(portalForOrder(mislabeled), 'https://advpro.app');
  assert.match(wrongProductMessage(mislabeled, 'Crunchyroll'), /Google Gemini/);
});

test('strict service isolation routes only matching products to their portals', () => {
  const crunchyroll = { service_type: 'crunchyroll', product_name: 'Crunchyroll Mega Fan' };
  const chatgpt = { service_type: 'chatgpt', product_name: 'ChatGPT Plus' };
  assert.equal(isCrunchyrollOrder(crunchyroll), true);
  assert.equal(isChatgptOrder(chatgpt), true);
  assert.equal(portalForOrder(crunchyroll, 'token_1234567890123456'), 'https://anime.advpro.app/token_1234567890123456');
  assert.equal(portalForOrder(chatgpt, 'token_1234567890123456'), 'https://gpt.advpro.app/token_1234567890123456');
});

test('customer portals display the verified device and hide pending credentials', async () => {
  const [crunchyroll, chatgpt, track, api] = await Promise.all([
    readFile(new URL('../ui/crunchyroll-portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/chatgpt-portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8'),
    readFile(new URL('../api/public/track.js', import.meta.url), 'utf8'),
  ]);
  for (const source of [crunchyroll, chatgpt, track]) {
    assert.match(source, /الجهاز الموثّق/);
    assert.match(source, /1 \/ 1 موثّق/);
  }
  assert.match(crunchyroll, /deliveryPending/);
  assert.match(chatgpt, /pendingDelivery/);
  assert.match(api, /trusted_device/);
  assert.match(api, /fingerprintId/);
  assert.match(crunchyroll, /mailMatchHint/);
  assert.match(crunchyroll, /مطابق لجهازك/);
});

test('all customer portals share the dark glass theme and clean dot-matrix hero', async () => {
  const files = [
    '../ui/single-order-home.html',
    '../ui/order-track.html',
    '../ui/crunchyroll-portal.html',
    '../ui/chatgpt-portal.html',
    '../ui/compensate-portal.html',
  ];
  const pages = await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  for (const page of pages) {
    assert.match(page, /#071a35/i);
    assert.match(page, /#9a3412 0%,\s*#ea580c 55%,\s*#c2410c 100%/i);
    assert.match(page, /radial-gradient\(rgba\(255,\s*255,\s*255,\s*\.16\)\s*1\.5px,\s*transparent\s+1\.5px\)/i);
    assert.match(page, /background-size:\s*24px 24px/i);
  }
  const shell = await readFile(new URL('../ui/single-order-home-shell.html', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /النظام يعمل بكفاءة/);
});

test('service subdomain heroes use distinct responsive artwork without the health badge', async () => {
  const [anime, gpt, warranty, home, homeShell] = await Promise.all([
    readFile(new URL('../ui/crunchyroll-portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/chatgpt-portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/compensate-portal.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/single-order-home.html', import.meta.url), 'utf8'),
    readFile(new URL('../ui/single-order-home-shell.html', import.meta.url), 'utf8'),
  ]);
  for (const page of [anime, gpt, warranty]) {
    assert.doesNotMatch(page, /النظام يعمل بكفاءة|class="eyebrow"/);
    assert.match(page, /class="hero-art/);
    assert.match(page, /aria-hidden="true"/);
    assert.match(page, /@media\(max-width:/);
    assert.match(page, /background:#050a18/i);
    assert.match(page, /html,\.service-page,\.service-shell\{background:#071a35\}/i);
    assert.match(page, /class="service-page/);
    assert.match(page, /class="service-shell"/);
    assert.match(page, /border-radius:0/);
    assert.match(page, /margin:-96px auto/);
  }
  assert.match(anime, /anime-art/);
  assert.match(gpt, /ai-art/);
  assert.match(warranty, /warranty-art/);
  assert.doesNotMatch(homeShell, /النظام يعمل بكفاءة/);
  assert.doesNotMatch(home, /class="hero-art/);
});

test('service portals offer a return to lookup only after entering the result view', async () => {
  const pages = await Promise.all([
    '../ui/crunchyroll-portal.html',
    '../ui/chatgpt-portal.html',
    '../ui/compensate-portal.html',
  ].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  for (const page of pages) {
    assert.match(page, /<\/p><button id="switchOrder" class="hero-switch-order" type="button" hidden>[^\n]+استعلام عن طلب آخر[^\n]+<\/button><\/div><\/section>/);
    assert.match(page, /\$\('switchOrder'\)\.hidden=(?:id|name)!=='(?:dashboard|result)'/);
    assert.match(page, /returnToOrderLookup\(/);
    assert.doesNotMatch(page, /flow-steps|flow-step|flowSteps/);
  }
});
