const productText = order => String(order?.product_name || '').trim();

export const isCrunchyrollOrder = order =>
  order?.service_type === 'crunchyroll' && /crunchyroll|كرانشي\s*رول/i.test(productText(order));

export const isChatgptOrder = order =>
  order?.service_type === 'chatgpt' && /chatgpt|openai|شات\s*(?:جي\s*بي\s*تي|GPT)/i.test(productText(order));

export function portalForOrder(order, token = '') {
  const suffix = token ? `/${encodeURIComponent(token)}` : '';
  if (isCrunchyrollOrder(order)) return `/crunchyroll${suffix}`;
  if (isChatgptOrder(order)) return `/chatgpt${suffix}`;
  return token ? `/track/${encodeURIComponent(token)}` : '/';
}

export function wrongProductMessage(order, expectedName) {
  const actual = productText(order) || 'منتج رقمي آخر';
  return `هذا الطلب يخص منتج (${actual}) وليس اشتراك ${expectedName}.`;
}
