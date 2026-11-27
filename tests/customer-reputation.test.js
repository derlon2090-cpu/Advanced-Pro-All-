import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerReputations, normalizeCustomerName } from '../lib/customer-reputation.js';

test('normalizes Arabic names without conflating unrelated identifiers', () => {
  assert.equal(normalizeCustomerName('أَحْمَد  العتيبي'), 'احمد العتيبي');
  const orders = [
    { id: 'a', customer_phone: '0500000001', security_strikes: 0, customers: { name: 'أحمد العتيبي' } },
    { id: 'b', customer_phone: '0500000002', security_strikes: 3, customers: { name: 'احمد العتيبي' } },
  ];
  const result = buildCustomerReputations(orders);
  assert.equal(result.a.badge, 'name_match');
  assert.equal(result.a.total_orders, 1);
  assert.equal(result.a.cumulative_strikes, 0);
});

test('aggregates confirmed identities and forces manual compensation after prior strikes', () => {
  const orders = [
    { id: 'a', customer_phone: '+966500000001', security_strikes: 0, customers: { name: 'سارة علي' } },
    { id: 'b', customer_phone: '0500000001', security_strikes: 2, customers: { name: 'ساره علي' } },
  ];
  const result = buildCustomerReputations(orders, [{ order_id: 'b', status: 'rejected' }]);
  assert.equal(result.a.badge, 'high_risk_repeat');
  assert.equal(result.a.total_orders, 2);
  assert.equal(result.a.cumulative_strikes, 2);
  assert.equal(result.a.cumulative_compensations, 1);
  assert.equal(result.a.requires_manual_compensation, true);
});

test('uses physical device hash as a confirmed identifier only with the same name', () => {
  const orders = [
    { id: 'a', security_strikes: 0, customers: { name: 'ليان محمد' } },
    { id: 'b', security_strikes: 0, customers: { name: 'ليان محمد' } },
    { id: 'c', security_strikes: 4, customers: { name: 'اسم مختلف' } },
  ];
  const events = [
    { order_id: 'a', physical_core_hash: 'core-1' },
    { order_id: 'b', physical_core_hash: 'core-1' },
    { order_id: 'c', physical_core_hash: 'core-1' },
  ];
  const result = buildCustomerReputations(orders, [], events);
  assert.equal(result.a.badge, 'trusted');
  assert.equal(result.a.total_orders, 2);
  assert.equal(result.a.cumulative_strikes, 0);
});
