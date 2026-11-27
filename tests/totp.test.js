import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTotp, normalizeTotpSecret } from '../lib/totp.js';

test('generates RFC 6238 SHA-1 vectors', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(generateTotp(secret, { timestamp: seconds * 1000, digits: 8 }).code, expected);
  }
});

test('normalizes whitespace and padding without accepting invalid Base32', () => {
  assert.equal(normalizeTotpSecret('jbsw y3dp ehpk 3pxp==='), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => normalizeTotpSecret('not-a-secret!'), /Base32/);
});

test('returns a six-digit code and a bounded countdown', () => {
  const result = generateTotp('JBSWY3DPEHPK3PXP', { timestamp: 31_000 });
  assert.match(result.code, /^\d{6}$/);
  assert.equal(result.seconds_remaining, 29);
  assert.equal(result.period, 30);
});

