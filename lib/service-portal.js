export const servicePortalUrl = (serviceType, trackingToken = '') => {
  const suffix = trackingToken ? `/${encodeURIComponent(trackingToken)}` : '';
  if (serviceType === 'crunchyroll') return `${process.env.CR_PORTAL_URL || process.env.CRUNCHYROLL_PORTAL_URL || 'https://anime.advpro.app'}${suffix}`;
  if (serviceType === 'chatgpt') return `${process.env.GPT_PORTAL_URL || process.env.CHATGPT_PORTAL_URL || 'https://gpt.advpro.app'}${suffix}`;
  const base = (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || 'https://advpro.app').replace(/\/$/, '');
  return trackingToken ? `${base}/track/${encodeURIComponent(trackingToken)}` : base;
};
