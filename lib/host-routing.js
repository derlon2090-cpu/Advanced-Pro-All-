const OFFICIAL_ROOT = 'advpro.app';
const ADMIN_HOST = 'waleed.advpro.app';

export function requestHost(request) {
  const headers = request?.headers;
  const forwarded = typeof headers?.get === 'function'
    ? headers.get('x-forwarded-host') || headers.get('host')
    : headers?.['x-forwarded-host'] || headers?.host;
  return String(forwarded || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
}

export const isOfficialHost = host => host === OFFICIAL_ROOT || host.endsWith(`.${OFFICIAL_ROOT}`);
export const isAdminHost = host => host === ADMIN_HOST;

export function blockAdminOutsideOfficialHost(request) {
  const host = requestHost(request);
  return isOfficialHost(host) && !isAdminHost(host);
}

export function enforceAdminHost(request, response) {
  if (!blockAdminOutsideOfficialHost(request)) return false;
  response.status(404).json({ message: 'Not Found' });
  return true;
}

export const officialHosts = Object.freeze({
  app: OFFICIAL_ROOT,
  admin: ADMIN_HOST,
  crunchyroll: 'anime.advpro.app',
  chatgpt: 'gpt.advpro.app',
  compensate: 'warranty.advpro.app',
});
