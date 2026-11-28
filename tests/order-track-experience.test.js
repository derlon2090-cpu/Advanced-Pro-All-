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
  assert.match(source, /الجهاز الموثّق/);
  assert.match(source, /order-info-grid/);
  assert.match(source, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(source, /referral-title-row/);
  assert.doesNotMatch(source, /أصدقاء مكتملين/);
});

test('order tracking verifies automatically and opens details behind the verified session', async () => {
  const source = await readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8');
  assert.match(source, /await previewOrder\(token\);\s+await showOrder\(\)/);
  assert.match(source, /const resumed = await resumeOrderDetails\(token, orderEndpoint\(token\)\);\s+if \(resumed\) \{\s+await loadVerifiedOrder\(false/);
  assert.match(source, /if \(!await verifyOrderDevice\([\s\S]*?\)\) return;\s+await loadVerifiedOrder\(true\)/);
  assert.doesNotMatch(source, /ackCheckbox|stageAckCheckbox|confirmOrderFound|journey-stepper|journey-step/);
  assert.match(source, /confirmed \? await revealVerified\(loadOrder\)/);
  assert.match(source, /retryOrderDetails/);
  assert.match(source, /const upsellCard = offer\?\.url/);
  assert.match(source, /\.track-night \.order-wrap \{ transform:none; \}/);
  assert.doesNotMatch(source, /translateY\(-(?:48|58)px\)/);
});

test('switching orders returns to the source portal using a known portal identifier', async () => {
  const source = await readFile(new URL('../ui/order-track.html', import.meta.url), 'utf8');
  const progress = await readFile(new URL('../lib/order-progress.js', import.meta.url), 'utf8');
  assert.match(source, /استعلام عن طلب آخر/);
  assert.match(source, /if \(event\.target\.closest\('#switchOrder'\)\) returnToOrderLookup\(\)/);
  assert.doesNotMatch(source, /anotherOrderForm|anotherOrderNumber/);
  assert.match(progress, /url\.searchParams\.set\('from', source\)/);
  assert.match(progress, /lookupHosts\.get\(new URL\(location\.href\)\.searchParams\.get\('from'\)\)/);
});

test('home verifies on the lookup page before opening the details document', async () => {
  const source = await readFile(new URL('../ui/single-order-home.html', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../ui/single-order-home-shell.html', import.meta.url), 'utf8');
  assert.match(source, /setOrderProgress\('search'\);[\s\S]*?fetch\('\/api\/public\/lookup'/);
  assert.match(source, /navigating = await openOrderDetails\(/);
  assert.doesNotMatch(source, /confirmOrderFound|order-transition/);
  assert.match(source, /normalizeOrderNumber/);
  assert.match(source, /\.order-input-wrap:focus-within/);
  assert.match(source, /background: #071a35/);
  assert.match(source, /form\.querySelector\('\.single-action'\)/);
  assert.match(shell, /id="pasteOrderNumber"/);
  assert.match(shell, /id="clearOrderNumber"/);
  assert.doesNotMatch(shell, /النظام يعمل بكفاءة/);
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
  const boot = html.indexOf("dataset.orderProgress=location.hash.startsWith('#open=')?'details':'search'");
  assert.ok(boot >= 0 && boot < html.search(/<body\b/));
  assert.match(html, /جارٍ التحقق من الطلب وتوثيق الجهاز…/);
  assert.doesNotMatch(html, /جارِ تجهيز تفاصيل طلبك/);
  assert.doesNotMatch(html, /<form id="singleOrderLookup"/);
  assert.doesNotMatch(html, /id="premiumLookup"/);
  assert.match(html, /class="track-verification-stage single-home">\s*<section class="split-top">/);
  assert.doesNotMatch(html, /نظام الضمان والمتابعة الذكي/);
  assert.ok(config.rewrites.some(route => route.source === '/track/:path*' && route.destination === '/track.html'));
  assert.ok(config.redirects.some(route => route.source === '/compensate/:path*' && route.destination === 'https://warranty.advpro.app/:path*'));
});

test('all public portals serve a shared in-place loader and have no manual device consent', async () => {
  for (const name of ['home','track','chatgpt','crunchyroll','compensate']) {
    const html = await readFile(new URL(`../public/${name}.html`, import.meta.url), 'utf8');
    assert.equal(html.match(/id="orderProgress"/g)?.length, 1, name);
    assert.equal(html.match(/تم التحقق من الطلب وتوثيق جهازك بنجاح ✓/g)?.length, 1, name);
    assert.match(html, /مطابقة بيانات الطلب…/);
    assert.match(html, /فحص بصمة المتصفح والجهاز…/);
    assert.match(html, /class="clean-footer"/);
    assert.match(html, /لا تجد رقم الطلب؟/);
    assert.match(html, /© بوابة أدفانسد برو/);
    assert.doesNotMatch(html, /آراء عملائنا المعتمدة|id="socialProof"|id="proofTrack"/);
    assert.doesNotMatch(html, /deviceBindingForm|أوافق على ربط الاشتراك|confirmOrderFound|id="continueToDevice"/);
    assert.equal(html.match(/<body\b/g)?.length, 1, name);
    if (name !== 'home') {
      const boot = html.indexOf("dataset.orderProgress=location.hash.startsWith('#open=')?'details':'search'");
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

