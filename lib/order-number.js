export function normalizeOrderNumber(input) {
  const normalized = String(input ?? '')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776));
  const hashNumber = normalized.match(/#\s*(\d{1,30})/);
  const plainNumber = normalized.match(/\d{1,30}/);
  return (hashNumber?.[1] || plainNumber?.[0] || '').slice(0, 30);
}
