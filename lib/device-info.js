const version = value => String(value || '').replace(/_/g, '.').match(/\d+(?:\.\d+){0,2}/)?.[0] || '';
const major = value => Number(version(value).split('.')[0] || 0);

const browserFrom = (ua, hints) => {
  const brands = Array.isArray(hints?.brands) ? hints.brands.map(item => String(item?.brand || '')).join(' ') : '';
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Internet';
  if (/Edg(?:A|iOS)?\//i.test(ua) || /Microsoft Edge/i.test(brands)) return 'Edge';
  if (/OPR\//i.test(ua) || /Opera/i.test(brands)) return 'Opera';
  if (/CriOS\//i.test(ua) || /Chrome\//i.test(ua) || /Google Chrome/i.test(brands)) return 'Chrome';
  if (/FxiOS\//i.test(ua) || /Firefox\//i.test(ua)) return 'Firefox';
  if (/Version\/[\d.]+.*Safari\//i.test(ua)) return 'Safari';
  if (/Crunchyroll/i.test(ua)) return 'تطبيق Crunchyroll';
  return 'متصفح';
};

export function parseDetailedDeviceInfo(userAgent, clientHints = {}) {
  const ua = String(userAgent || ''), platform = String(clientHints.platform || ''), platformVersion = version(clientHints.platformVersion);
  const touchPoints = Number(clientHints.maxTouchPoints || 0), model = String(clientHints.model || '').replace(/[<>\r\n]/g, '').trim().slice(0, 50);
  const browser = browserFrom(ua, clientHints);
  let category = 'computer', deviceType = 'جهاز غير معروف', os = '';

  if (/smart-tv|smarttv|hbbtv|netcast|viera|web0s|webos|tizen|appletv|googletv|android tv/i.test(ua)) {
    category = 'tv'; deviceType = 'شاشة ذكية Smart TV';
    os = /tizen/i.test(ua) ? 'Tizen' : /web0s|webos/i.test(ua) ? 'webOS' : /android/i.test(ua) ? 'Android TV' : 'Smart TV';
  } else if (/ipad/i.test(ua) || (/macintosh/i.test(ua) && touchPoints > 1)) {
    category = 'tablet'; deviceType = 'جهاز لوحي iPad';
    const osVersion = version(ua.match(/OS ([\d_]+)/i)?.[1] || platformVersion); os = osVersion ? `iPadOS ${major(osVersion)}` : 'iPadOS';
  } else if (/iphone|ipod/i.test(ua)) {
    category = 'mobile'; deviceType = 'جوال iPhone';
    const osVersion = version(ua.match(/OS ([\d_]+)/i)?.[1] || platformVersion); os = osVersion ? `iOS ${major(osVersion)}` : 'iOS';
  } else if (/android/i.test(ua) || /android/i.test(platform)) {
    category = /tablet|sm-t|nexus 7|nexus 9/i.test(`${ua} ${model}`) || clientHints.mobile === false ? 'tablet' : 'mobile';
    deviceType = category === 'tablet' ? 'جهاز لوحي Android' : 'جوال Android';
    const osVersion = version(ua.match(/Android\s+([\d.]+)/i)?.[1] || platformVersion); os = osVersion ? `Android ${major(osVersion)}` : 'Android';
  } else if (/windows/i.test(ua) || /windows/i.test(platform)) {
    category = 'computer';
    const win11 = major(platformVersion) >= 13, uaVersion = ua.match(/Windows NT\s+([\d.]+)/i)?.[1];
    os = win11 ? 'Windows 11' : platformVersion ? 'Windows 10' : uaVersion === '10.0' ? 'Windows 10/11' : 'Windows';
    deviceType = `كمبيوتر ${os}`;
  } else if (/macintosh|mac os/i.test(ua) || /macos/i.test(platform)) {
    category = 'computer'; deviceType = 'جهاز Mac';
    const osVersion = version(platformVersion || ua.match(/Mac OS X\s+([\d_]+)/i)?.[1]); os = osVersion ? `macOS ${major(osVersion)}` : 'macOS';
  } else if (/linux/i.test(ua) || /linux/i.test(platform)) {
    category = 'computer'; deviceType = 'كمبيوتر Linux'; os = 'Linux';
  }

  const systemLabel = os && !deviceType.includes(os) ? ` (${os})` : '';
  return { category, deviceType, os, browser, model: model || null, label: `${deviceType} • ${browser}${systemLabel}` };
}

export function extractApprovalDeviceInfo(text) {
  const source = String(text || '');
  const device = [
    [/iPhone/i, 'iPhone'], [/iPad/i, 'iPad'], [/Android/i, 'Android'],
    [/Windows/i, 'Windows'], [/(?:Macintosh|MacBook|macOS|Mac OS)/i, 'Mac'],
    [/(?:Smart TV|Android TV|Apple TV|Tizen|webOS)/i, 'Smart TV'],
  ].find(([pattern]) => pattern.test(source))?.[1] || null;
  const browser = [
    [/Samsung Internet|SamsungBrowser/i, 'Samsung Internet'], [/Edge|Edg\//i, 'Edge'],
    [/Chrome|CriOS/i, 'Chrome'], [/Safari/i, 'Safari'], [/Firefox|FxiOS/i, 'Firefox'],
  ].find(([pattern]) => pattern.test(source))?.[1] || null;
  return { device, browser, label: [device, browser].filter(Boolean).join(' • ') || null };
}
