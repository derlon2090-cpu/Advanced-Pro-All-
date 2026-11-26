const httpsUrl = value => {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.toString() : null; }
  catch { return null; }
};

export const serviceFromProduct = name => /crunchyroll/i.test(name || '') ? 'crunchyroll' : /chatgpt|openai/i.test(name || '') ? 'chatgpt' : 'general_subscription';

export function normalizeSallaProduct(item = {}) {
  const product = item.product || item;
  const id = product.id || item.product_id || item.id || item.sku;
  const name = product.name || item.name || '';
  if (!id || !name) return null;
  return {
    salla_product_id: String(id),
    product_title: String(name).trim().slice(0, 250),
    service_type: serviceFromProduct(name),
    duration_days: 30,
    has_warranty: true,
    warranty_days: 30,
    salla_product_url: httpsUrl(product.urls?.customer || product.url || item.urls?.customer || item.url),
    updated_at: new Date().toISOString(),
  };
}

export async function insertUnknownSallaProduct(db, item) {
  const product = normalizeSallaProduct(item);
  if (!product) return { inserted: false, product: null };
  const result = await db('salla_product_mappings?on_conflict=salla_product_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(product),
  });
  if (!result.ok) throw new Error('تعذر مزامنة المنتج من سلة.');
  const rows = await result.json().catch(() => []);
  return { inserted: rows.length > 0, product };
}

export async function upsertSallaProducts(db, products) {
  const normalized = products.map(normalizeSallaProduct).filter(Boolean);
  if (!normalized.length) return 0;
  const currentResult = await db('salla_product_mappings?select=salla_product_id');
  if (!currentResult.ok) throw new Error('تعذر قراءة منتجات سلة الحالية.');
  const current = new Set((await currentResult.json()).map(row => String(row.salla_product_id)));
  const fresh = normalized.filter(product => !current.has(product.salla_product_id));
  if (fresh.length) {
    const inserted = await db('salla_product_mappings?on_conflict=salla_product_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(fresh),
    });
    if (!inserted.ok) throw new Error('تعذر إضافة منتجات سلة الجديدة.');
  }
  for (const product of normalized.filter(item => current.has(item.salla_product_id))) {
    const updated = await db(`salla_product_mappings?salla_product_id=eq.${encodeURIComponent(product.salla_product_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ product_title: product.product_title, salla_product_url: product.salla_product_url, updated_at: product.updated_at }),
    });
    if (!updated.ok) throw new Error('تعذر تحديث بيانات منتج سلة.');
  }
  return normalized.length;
}
