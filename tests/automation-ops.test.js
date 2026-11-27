import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSallaCouponPayload } from '../lib/salla-referral-coupons.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Salla referral coupon is single-use and expires on the configured date', () => {
  const payload = buildSallaCouponPayload({ code: 'ADVPRO-22-9X4A', type: 'percentage', amount: 25, expiryDays: 14 });
  assert.equal(payload.code, 'ADVPRO-22-9X4A');
  assert.equal(payload.usage_limit, 1);
  assert.equal(payload.usage_limit_per_user, 1);
  assert.equal(payload.type, 'percentage');
  assert.equal(payload.amount, 25);
  assert.equal(payload.free_shipping, false);
  assert.equal(payload.exclude_sale_products, false);
  assert.ok(new Date(payload.expiry_date) > new Date(payload.start_date));
});

test('referral migration blocks self-referral and issues a new milestone every target cycle', async () => {
  const migration = await read('supabase/migrations/030_automation_coupons_inventory_kpis.sql');
  assert.match(migration, /self_referral_blocked/);
  assert.match(migration, /customer_phone/);
  assert.match(migration, /customer_email/);
  assert.match(migration, /locked_device_fingerprint_hash/);
  assert.match(migration, /last_lookup_ip_hash/);
  assert.match(migration, /mod\(v_count,v_target\)=0/);
  assert.doesNotMatch(migration, /expires_at\s*=\s*expires_at\s*\+/);
});

test('paid Salla events provision instantly and send service-specific onboarding', async () => {
  const webhook = await read('api/webhooks/salla.js');
  assert.match(webhook, /order\.payment\.updated/);
  assert.match(webhook, /assign_order_to_available_account/);
  assert.match(webhook, /auto_provisioned_at/);
  assert.match(webhook, /sendOnboardingEmail/);
  assert.match(webhook, /servicePortalUrl/);
});

test('inventory health cron is protected, quarantines failures and feeds the admin bell daily', async () => {
  const [cron, config] = await Promise.all([read('lib/cron-handlers.js'), read('vercel.json')]);
  assert.match(cron, /inventoryHealth/);
  assert.match(cron, /operational_status:quarantine\?'quarantined':'available'/);
  assert.match(cron, /admin_notifications/);
  assert.doesNotMatch(cron, /Telegram/);
  const vercel = JSON.parse(config);
  assert.ok(vercel.crons.some(item => item.path === '/api/cron/inventory-health' && item.schedule === '0 10 * * *'));
});
