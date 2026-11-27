import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readBuiltDocument = async names => {
  for (const name of names) {
    try { return await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`Missing built document: ${names.join(' or ')}`);
};

const assertNoLegacyPrepaint = async (documentNames, routeClass, revealRule) => {
  const html = await readBuiltDocument(documentNames);
  const hide = html.indexOf('html.current-home body,html.current-track body{visibility:hidden}');
  const boot = html.indexOf(`classList.add('${routeClass}')`);
  const body = html.indexOf('<body>');
  const reveal = html.indexOf(revealRule);

  assert.ok(hide >= 0 && hide < body, 'the pre-paint guard must be parsed in <head>');
  assert.ok(boot >= 0 && boot < body, 'the route class must be applied before <body> is parsed');
  assert.ok(reveal > body, 'the current interface must reveal only after its styles are parsed');
};

test('homepage never paints the legacy interface before the current design', async () => {
  await assertNoLegacyPrepaint(['home.html', 'index.html'], 'current-home', 'html.current-home body { visibility: visible !important; }');
});

test('order tracking never paints the legacy interface before the secure design', async () => {
  await assertNoLegacyPrepaint(['track.html'], 'current-track', 'html.current-track body { visibility: visible !important; }');
});
