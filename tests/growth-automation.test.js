import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.match(sql,/compensation_evidence_hash_unique_idx/);
  assert.match(sql,/reward_order_referral/);
  assert.match(sql,/interval '5 days'/);
  assert.match(sql,/admin_resolve_compensation/);
});

test('customer pages expose timed upsell, referral sharing, evidence and social proof',async()=>{
  const track=await readFile(new URL('../ui/order-track.html',import.meta.url),'utf8');
  const home=await readFile(new URL('../ui/single-order-home.html',import.meta.url),'utf8');
  assert.match(track,/offerCountdown/);assert.match(track,/copyReferral/);assert.match(track,/compensationEvidence/);
  assert.match(home,/api\/public\/reviews/);assert.match(home,/advpro_referral/);
});
