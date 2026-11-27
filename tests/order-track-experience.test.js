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

test('fulfillment migration resets subscription and warranty start dates', async () => {
  const sql = await readFile(new URL('../supabase/migrations/018_subscription_starts_on_fulfillment.sql', import.meta.url), 'utf8');
  assert.match(sql, /starts_at = v_started_at/);
  assert.match(sql, /expires_at = v_started_at \+ make_interval/);
  assert.match(sql, /warranty_expires_at = case when has_warranty/);
  assert.match(sql, /status = 'delivered'/);
});

