import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isChatgptOrder, isCrunchyrollOrder, portalForOrder, wrongProductMessage } from '../lib/service-product.js';

test('strict service isolation rejects a mislabeled Gemini order', () => {
  const mislabeled = { service_type: 'crunchyroll', product_name: 'Google Gemini – رابط تفعيل عرض 18 شهرًا' };
  assert.equal(isCrunchyrollOrder(mislabeled), false);
  assert.equal(portalForOrder(mislabeled), '/');
  assert.match(wrongProductMessage(mislabeled, 'Crunchyroll'), /Google Gemini/);
});

test('strict service isolation routes only matching products to their portals', () => {
  const crunchyroll = { service_type: 'crunchyroll', product_name: 'Crunchyroll Mega Fan' };
  const chatgpt = { service_type: 'chatgpt', product_name: 'ChatGPT Plus' };
  assert.equal(isCrunchyrollOrder(crunchyroll), true);
  assert.equal(isChatgptOrder(chatgpt), true);
  assert.equal(portalForOrder(crunchyroll, 'token_1234567890123456'), '/crunchyroll/token_1234567890123456');
  assert.equal(portalForOrder(chatgpt, 'token_1234567890123456'), '/chatgpt/token_1234567890123456');
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
});
