const databaseName = 'advanced-pro-device-binding';
const storeName = 'anchors';
const openDb = () => new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) return resolve(null);
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function getBindAnchor(token) {
  try {
    const db = await openDb(); if (!db) return '';
    return await new Promise((resolve, reject) => { const request = db.transaction(storeName).objectStore(storeName).get(String(token)); request.onsuccess = () => resolve(String(request.result || '')); request.onerror = () => reject(request.error); });
  } catch { return ''; }
}
export async function saveBindAnchor(token, anchor) {
  if (!token || !anchor) return;
  try {
    const db = await openDb(); if (!db) return;
    await new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(String(anchor), String(token)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  } catch {}
}
export async function clearBindAnchor(token) {
  try { const db = await openDb(); if (!db) return; await new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(String(token)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch {}
}
export async function bindingHeaders(token, extra = {}) {
  const anchor = await getBindAnchor(token);
  return anchor ? { ...extra, 'x-device-bind-anchor': anchor } : extra;
}
