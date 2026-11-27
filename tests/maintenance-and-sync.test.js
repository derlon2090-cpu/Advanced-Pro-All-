import test from 'node:test';
import assert from 'node:assert/strict';
import { blockForMaintenance, getMaintenanceMode, maintenanceAppliesTo, normalizeMaintenanceSettings } from '../lib/maintenance-mode.js';
import { insertUnknownSallaProduct, normalizeSallaProduct, upsertSallaProducts } from '../lib/salla-products.js';

test('maintenance blocks public APIs but excludes admin and Salla webhooks', () => {
  assert.equal(maintenanceAppliesTo('/api/public/lookup'), true);
  assert.equal(maintenanceAppliesTo('/api/public/track'), true);
  assert.equal(maintenanceAppliesTo('/api/public/system-settings'), false);
  assert.equal(maintenanceAppliesTo('/api/admin/operations'), false);
  assert.equal(maintenanceAppliesTo('/api/webhooks/salla'), false);
});

test('maintenance state returns 503 with the configured customer message', async () => {
  const previousUrl = process.env.SUPABASE_URL, previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const fetchImpl = async () => ({ ok: true, json: async () => [{ maintenance_enabled: true, maintenance_message: 'صيانة مجدولة' }] });
  assert.deepEqual(await getMaintenanceMode(fetchImpl), { enabled: true, message: 'صيانة مجدولة' });
  const output = { headers: {}, statusCode: 0, body: null };
  const response = { setHeader: (key, value) => { output.headers[key] = value; }, status: code => { output.statusCode = code; return response; }, json: body => { output.body = body; return response; } };
  assert.equal(await blockForMaintenance(response, fetchImpl), true);
  assert.equal(output.statusCode, 503);assert.equal(output.body.maintenance, true);assert.equal(output.body.message, 'صيانة مجدولة');
  if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

test('maintenance remains usable before migration 017 through legacy banner fields', () => {
  assert.deepEqual(normalizeMaintenanceSettings({ banner_active: true, banner_message: 'تحديث سريع' }), { enabled: true, message: 'تحديث سريع' });
  assert.deepEqual(normalizeMaintenanceSettings({ maintenance_enabled: false, maintenance_message: 'حديث', banner_active: true }), { enabled: false, message: 'حديث' });
});

test('a new Salla order product is normalized and inserted with safe defaults', async () => {
  const calls = [];
  const db = async (path, options) => { calls.push({ path, options }); return { ok: true, json: async () => [{ id: 'created' }] }; };
  const item = { product: { id: 4421, name: 'Crunchyroll شهر', urls: { customer: 'https://salla.sa/p4421' } } };
  const normalized = normalizeSallaProduct(item);
  assert.equal(normalized.salla_product_id, '4421');assert.equal(normalized.service_type, 'crunchyroll');assert.equal(normalized.has_warranty, true);assert.equal(normalized.warranty_days, 30);
  const result = await insertUnknownSallaProduct(db, item);
  assert.equal(result.inserted, true);assert.equal(calls.length, 1);assert.match(calls[0].path, /salla_product_mappings/);
  const saved = JSON.parse(calls[0].options.body);assert.equal(saved.product_title, 'Crunchyroll شهر');assert.equal(saved.salla_product_url, 'https://salla.sa/p4421');
});

test('manual Salla sync refreshes title and URL without overwriting warranty policy', async () => {
  const calls = [];
  const db = async (path, options = {}) => {
    calls.push({ path, options });
    if (path.includes('select=salla_product_id')) return { ok: true, json: async () => [{ salla_product_id: '77' }] };
    return { ok: true, json: async () => [] };
  };
  assert.equal(await upsertSallaProducts(db, [{ id: 77, name: 'ChatGPT Plus', url: 'https://salla.sa/p77' }]), 1);
  const patchCall = calls.find(call => call.options.method === 'PATCH');
  const body = JSON.parse(patchCall.options.body);
  assert.equal(body.product_title, 'ChatGPT Plus');assert.equal(body.salla_product_url, 'https://salla.sa/p77');
  assert.equal('has_warranty' in body, false);assert.equal('warranty_days' in body, false);
});

