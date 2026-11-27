import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrderNumber } from '../lib/order-number.js';

test('normalizeOrderNumber accepts hashes, Arabic digits, and pasted order text', () => {
  assert.equal(normalizeOrderNumber('#123456'), '123456');
  assert.equal(normalizeOrderNumber('123456'), '123456');
  assert.equal(normalizeOrderNumber('١٢٣٤٥٦'), '123456');
  assert.equal(normalizeOrderNumber('طلب #123456'), '123456');
});
