import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('standalone compensation portal exposes secure token and order-number entry flows', async () => {
  const [page, build, vercel] = await Promise.all([
    read('ui/compensate-portal.html'),
    read('scripts/build.mjs'),
    read('vercel.json'),
  ]);
  assert.match(page, /بوابة التعويض والاستبدال الفوري/);
  assert.ok(page.includes("location.pathname.match(/^\\/compensate\\/([a-zA-Z0-9_-]{16,128})"));
  assert.match(page, /URLSearchParams\(location\.search\)\.get\('order'\)/);
  assert.match(page, /collectDeviceDna/);
  assert.match(page, /image\/png,image\/jpeg,image\/webp/);
  assert.match(build, /compensate\.html/);
  assert.match(vercel, /"source": "\/compensate"/);
});

test('compensation API deduplicates evidence and returns immediate replacement credentials', async () => {
  const [api, migration, admin] = await Promise.all([
    read('api/public/compensate.js'),
    read('supabase/migrations/026_smart_compensation_portal.sql'),
    read('ui/admin-dashboard.html'),
  ]);
  assert.match(api, /createHash\('sha256'\)\.update\(imageBytes\)/);
  assert.match(api, /duplicateEvidence/);
  assert.match(api, /status: decision\?\.approved \? 'auto_approved' : queued \? 'queued'/);
  assert.match(api, /credentials/);
  assert.match(migration, /compensation_rejected_with_strike/);
  assert.match(admin, /Duplicate Image Hash/);
  assert.match(admin, /اعتماد وتعويض فوري/);
  assert.match(admin, /رفض مع تسجيل مخالفة/);
});

test('all customer portals link to compensation by tracking token', async () => {
  const pages = await Promise.all([
    read('ui/order-track.html'),
    read('ui/crunchyroll-portal.html'),
    read('ui/chatgpt-portal.html'),
  ]);
  for (const page of pages) assert.match(page, /\/compensate\/'/);
});
