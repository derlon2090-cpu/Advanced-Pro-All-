import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { decryptPassword, encryptPassword } from '../lib/account-credentials.js';

test('shared account passwords are encrypted and decryptable only with the server key', () => {
  const previous=process.env.ENCRYPTION_KEY;process.env.ENCRYPTION_KEY='test-key-not-for-production';
  const payload=encryptPassword('Strong-Pass-123');
  assert.notEqual(payload.ciphertext,'Strong-Pass-123');
  assert.equal(decryptPassword(payload),'Strong-Pass-123');
  if(previous===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=previous;
});

test('growth migration includes referral reward and evidence deduplication safeguards', async()=>{
  const sql=await readFile(new URL('../supabase/migrations/021_growth_automation_and_compensation_evidence.sql',import.meta.url),'utf8');
  assert.match(sql,/create index if not exists idx_compensation_requests_evidence_image_hash\s+on public\.compensation_requests \(evidence_image_hash\)/i);
  assert.doesNotMatch(sql,/create unique index[^;]+evidence_image_hash/is);
  assert.match(sql,/reward_order_referral/);
  assert.match(sql,/interval '5 days'/);
  assert.match(sql,/admin_resolve_compensation/);
});

test('five-friend referral migration unlocks a configurable coupon',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/022_referral_5_friends_coupon.sql',import.meta.url),'utf8');
  assert.match(sql,/referral_coupon_target integer not null default 5/i);
  assert.match(sql,/referral_assigned_coupon text/i);
  assert.match(sql,/count\(\*\).*referral_rewards/is);
  assert.match(sql,/referral_coupon_unlocked_at = coalesce/i);
});

test('latest referral reward issues a unique coupon without extending subscription dates',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/028_referral_coupon_only.sql',import.meta.url),'utf8');
  assert.match(sql,/referral_assigned_coupon = coalesce/i);
  assert.match(sql,/v_coupon_prefix/i);
  assert.doesNotMatch(sql,/set\s+expires_at\s*=/i);
  assert.doesNotMatch(sql,/warranty_expires_at\s*=/i);
  assert.doesNotMatch(sql,/interval\s+'\d+\s+days?'/i);
});

test('wrong-device compensation attempts are rejected and visible to administrators',async()=>{
  const source=await readFile(new URL('../api/public/compensate.js',import.meta.url),'utf8');
  assert.match(source,/device_mismatch_blocked:\s*true/);
  assert.match(source,/status:\s*'rejected'/);
  assert.match(source,/event_type:\s*'compensation_wrong_device'/);
});

test('official defaults use advpro.app for links and outbound email',async()=>{
  const env=await readFile(new URL('../.env.example',import.meta.url),'utf8');
  const email=await readFile(new URL('../lib/operational-email.js',import.meta.url),'utf8');
  assert.match(env,/APP_BASE_URL=https:\/\/advpro\.app/);
  assert.match(env,/PUBLIC_APP_URL=https:\/\/advpro\.app/);
  assert.match(env,/RESEND_FROM_EMAIL=noreply@advpro\.app/);
  assert.match(email,/noreply@advpro\.app/);
});

test('Vercel Hobby deployment stays within the 12 serverless function limit',async()=>{
  const walk=async dir=>{const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(entry=>entry.isDirectory()?walk(new URL(`${entry.name}/`,dir)):entry.name.endsWith('.js')?[new URL(entry.name,dir)]:[]))).flat()};
  const functions=await walk(new URL('../api/',import.meta.url));
  assert.ok(functions.length<=12,`Found ${functions.length} API functions`);
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.ok(config.rewrites.some(route=>route.source==='/api/cron/daily-digest'&&route.destination.includes('/api/cron?job=')));
});

test('customer pages expose referral progress, coupon sharing and compensation evidence',async()=>{
  const track=await readFile(new URL('../ui/order-track.html',import.meta.url),'utf8');
  const home=await readFile(new URL('../ui/single-order-home.html',import.meta.url),'utf8');
  assert.match(track,/offerCountdown/);assert.match(track,/referral-progress/);assert.match(track,/copyReferral/);assert.match(track,/coupon-unlocked/);assert.match(track,/compensationEvidence/);
  assert.doesNotMatch(home,/api\/public\/reviews/);assert.match(home,/advpro_referral/);
});
