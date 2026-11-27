import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('order tracking uses the split brand layout and explicit lifecycle labels', async () => {
  const source = await readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8');
  assert.match(source, /linear-gradient\(135deg, #7c2d12 0%, #c2410c 50%, #ea580c 100%\)/);
  assert.match(source, /تم التنفيذ • بدأ سريان الاشتراك ✓/);
  assert.match(source, /قيد التنفيذ • سيبدأ احتساب المدة فور التفعيل/);
  assert.match(source, /انتهت مدة الاشتراك/);
  assert.match(source, /تاريخ التنفيذ وبداية السريان/);
  assert.match(source, /بصمة الجهاز الفيزيائية/);
});

test('home lookup shows a branded transition before navigation', async () => {
  const source = await readFile(new URL('../ui/single-order-home.html', import.meta.url), 'utf8');
  assert.match(source, /order-transition/);
  assert.match(source, /جارِ فتح تفاصيل الاشتراك بأمان/);
});

test('home page renders immediately without the orange split boot screen', async () => {
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const source = await readFile(new URL('../ui/single-order-home.html', import.meta.url), 'utf8');
  assert.doesNotMatch(build, /split-boot/);
  assert.doesNotMatch(build, /body\{opacity:0!important\}/);
  assert.doesNotMatch(source, /portal\.innerHTML/);
});

test('built homepage contains only the current lookup design and disables document caching', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(html, /<form id="singleOrderLookup"/);
  assert.doesNotMatch(html, /<section class="hero"><span class="chip">نظام الضمان والمتابعة الذكي/);
  assert.doesNotMatch(html, /id="premiumLookup"/);
  assert.ok(config.headers.some(rule => rule.source === '/' && rule.headers.some(header => header.key === 'Cache-Control' && header.value.includes('no-store'))));
});

test('track routes use a dedicated secure loading document without homepage flashes', async () => {
  const html = await readFile(new URL('../public/track.html', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(html, /<span class="order-number">بوابة الطلب الآمنة<\/span>/);
  assert.match(html, /جارِ تجهيز تفاصيل طلبك/);
  assert.doesNotMatch(html, /<form id="singleOrderLookup"/);
  assert.doesNotMatch(html, /id="premiumLookup"/);
  assert.doesNotMatch(html, /نظام الضمان والمتابعة الذكي/);
  assert.ok(config.rewrites.some(route => route.source === '/track/:path*' && route.destination === '/track.html'));
  assert.ok(config.rewrites.some(route => route.source === '/compensate/:path*' && route.destination === '/track.html'));
});

test('fulfillment migration resets subscription and warranty start dates', async () => {
  const sql = await readFile(new URL('../supabase/migrations/018_subscription_starts_on_fulfillment.sql', import.meta.url), 'utf8');
  assert.match(sql, /starts_at = v_started_at/);
  assert.match(sql, /expires_at = v_started_at \+ make_interval/);
  assert.match(sql, /warranty_expires_at = case when has_warranty/);
  assert.match(sql, /status = 'delivered'/);
});

