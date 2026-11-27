import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('order tracking uses the split brand layout and explicit lifecycle labels', async () => {
  const source = await readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8');
  assert.match(source, /linear-gradient\(135deg, #9a3412 0%, #ea580c 55%, #c2410c 100%\)/);
  assert.match(source, /حالة الطلب: سارٍ ✓/);
  assert.match(source, /حالة الطلب: تحت المراجعة والتجهيز ⏳/);
  assert.match(source, /حالة الطلب: منتهي/);
  assert.match(source, /الوقت المتوقع للتسليم والتفعيل/);
  assert.match(source, /تم التسليم والتفعيل بنجاح ✓/);
  assert.match(source, /defaultDeliveryEstimate/);
  assert.match(source, /setTimeout\(async \(\) => \{\s+try \{\s+const payload = await loadOrder\(displayedToken\);\s+if \(token === displayedToken\) render\(payload\)/);
  assert.match(source, /بداية السريان/);
  assert.match(source, /بصمة الجهاز/);
  assert.match(source, /order-info-grid/);
  assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(source, /referral-title-row/);
  assert.doesNotMatch(source, /أصدقاء مكتملين/);
});

test('order tracking confirms the order before verification and opens details after verification', async () => {
  const source = await readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8');
  assert.match(source, /await findOrder\(\);\s+await showOrder\(\)/);
  assert.match(source, /await confirmOrderFound\(\);\s+await startVerification\(\)/);
  assert.match(source, /setOrderProgress\('verify'\);[\s\S]*?verifyDevice\('verify', dna\)/);
  assert.match(source, /if \(response\.ok && security\.allowed\) return await loadVerifiedOrder\(\)/);
  assert.match(source, /أوافق وأُوثّق جهازي الآن/);
  assert.doesNotMatch(source, /journey-stepper|journey-step/);
  assert.match(source, /enterVerified\(await loadOrder\(\)\)/);
  assert.match(source, /retryOrderDetails/);
  assert.match(source, /const upsellCard = offer\?\.url/);
  assert.match(source, /\.track-night \.order-wrap \{ transform:none; \}/);
  assert.doesNotMatch(source, /translateY\(-(?:48|58)px\)/);
});

test('order details switch to another lookup in place without a page reload', async () => {
  const source = await readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8');
  assert.match(source, /استعلام عن طلب آخر/);
  assert.match(source, /showAnotherOrderLookup/);
  assert.match(source, /history\.replaceState\(\{\},'', '\/'\)/);
  assert.match(source, /anotherOrderNumber/);
  assert.match(source, /input\.focus\(\)/);
  assert.match(source, /destination\.origin !== location\.origin/);
  assert.match(source, /await findOrder\(nextToken\);\s+history\.replaceState\(/);
  assert.doesNotMatch(source, /switchOrder[^\n]+location\.(?:assign|replace|reload)/);
});

test('home lookup keeps the search state until the tracking page confirms the order', async () => {
  const source = await readFile(new URL('../ui/single-order-home.html', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../ui/single-order-home-shell.html', import.meta.url), 'utf8');
  assert.match(source, /setOrderProgress\('search'\);[\s\S]*?fetch\('\/api\/public\/lookup'/);
  assert.match(source, /location\.assign\(data\.redirectTo\)/);
  assert.doesNotMatch(source, /confirmOrderFound|order-transition/);
  assert.match(source, /normalizeOrderNumber/);
  assert.match(source, /\.order-input-wrap:focus-within/);
  assert.match(source, /background: #071a35/);
  assert.match(source, /form\.querySelector\('\.single-action'\)/);
  assert.match(shell, /id="pasteOrderNumber"/);
  assert.match(shell, /id="clearOrderNumber"/);
  assert.match(shell, /النظام يعمل بكفاءة/);
  assert.match(shell, /عرض بيانات الاشتراك ←/);
});

test('tracking page links to the dedicated compensation portal without legacy support UI', async () => {
  const source = await readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8');
  assert.match(source, /showCompensation = directCompensation/);
  assert.match(source, /compensation-link-line/);
  assert.match(source, /\/compensate\//);
  assert.doesNotMatch(source, /طلب دعم \/ تعويض الضمان \(واتساب\)/);
  assert.doesNotMatch(source, /بوابة Crunchyroll غير مهيأة حاليًا/);
  assert.doesNotMatch(source, /order-watermark/);
  assert.doesNotMatch(source, /Array\.from\(\{ length: 15 \}/);
  assert.match(source, /isCrunchyroll = \/crunchyroll\|كرانشي/i);
  assert.match(source, /policy-details/);
});

test('home page renders immediately without the orange split boot screen', async () => {
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const source = await readFile(new URL('../ui/single-order-home.html', import.meta.url), 'utf8');
  assert.doesNotMatch(build, /split-boot/);
  assert.doesNotMatch(build, /body\{opacity:0!important\}/);
  assert.doesNotMatch(source, /portal\.innerHTML/);
});

test('built homepage contains only the current lookup design and disables document caching', async () => {
  const html = await readFile(new URL('../public/home.html', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(html, /<form id="singleOrderLookup"/);
  assert.doesNotMatch(html, /<section class="hero"><span class="chip">نظام الضمان والمتابعة الذكي/);
  assert.doesNotMatch(html, /id="premiumLookup"/);
  assert.ok(config.headers.some(rule => rule.source === '/:path*' && rule.headers.some(header => header.key === 'Cache-Control' && header.value.includes('no-store'))));
});

test('track routes use a dedicated secure loading document without homepage flashes', async () => {
  const html = await readFile(new URL('../public/track.html', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const boot = html.indexOf("dataset.orderProgress='search'");
  assert.ok(boot >= 0 && boot < html.search(/<body\b/));
  assert.match(html, /جارِ البحث عن طلبك…/);
  assert.doesNotMatch(html, /جارِ تجهيز تفاصيل طلبك/);
  assert.doesNotMatch(html, /<form id="singleOrderLookup"/);
  assert.doesNotMatch(html, /id="premiumLookup"/);
  assert.doesNotMatch(html, /نظام الضمان والمتابعة الذكي/);
  assert.ok(config.rewrites.some(route => route.source === '/track/:path*' && route.destination === '/track.html'));
  assert.ok(config.redirects.some(route => route.source === '/compensate/:path*' && route.destination === 'https://warranty.advpro.app/:path*'));
});

test('all public portals serve the same progress screen with one confirmation label', async () => {
  for (const name of ['home','track','chatgpt','crunchyroll','compensate']) {
    const html = await readFile(new URL(`../public/${name}.html`, import.meta.url), 'utf8');
    assert.equal(html.match(/id="orderProgress"/g)?.length, 1, name);
    assert.equal(html.match(/تم العثور على طلبك/g)?.length, 1, name);
    assert.match(html, /data-progress-label="search">جارِ البحث عن طلبك…/, name);
    assert.match(html, /data-progress-label="verify">التحقق من الجهاز…/, name);
    assert.equal(html.match(/<body\b/g)?.length, 1, name);
    if (name !== 'home') {
      const boot = html.indexOf("dataset.orderProgress='search'");
      assert.ok(boot >= 0 && boot < html.search(/<body\b/), name);
    }
  }
});

test('fulfillment migration resets subscription and warranty start dates', async () => {
  const sql = await readFile(new URL('../supabase/migrations/018_subscription_starts_on_fulfillment.sql', import.meta.url), 'utf8');
  assert.match(sql, /starts_at = v_started_at/);
  assert.match(sql, /expires_at = v_started_at \+ make_interval/);
  assert.match(sql, /warranty_expires_at = case when has_warranty/);
  assert.match(sql, /status = 'delivered'/);
});

test('delivery estimate is configurable and exposed to pending orders', async () => {
  const migration = await readFile(new URL('../supabase/migrations/025_order_delivery_estimate.sql', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../api/admin/operations.js', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../ui/admin-dashboard.html', import.meta.url), 'utf8');
  const publicInfo = await readFile(new URL('../lib/public-info-handlers.js', import.meta.url), 'utf8');
  assert.match(migration, /default_delivery_estimate text/);
  assert.match(admin, /save_delivery_estimate/);
  assert.match(dashboard, /الوقت المتوقع للتسليم الافتراضي/);
  assert.match(publicInfo, /defaultDeliveryEstimate/);
});

