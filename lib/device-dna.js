import { parseDetailedDeviceInfo } from './device-info.js';

const sha256 = async value => {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const platformFamily = userAgent => {
  const ua = String(userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows/.test(ua)) return 'windows';
  if (/macintosh|mac os/.test(ua)) return 'macos';
  if (/linux/.test(ua)) return 'linux';
  return 'other';
};

const browserFamily = userAgent => {
  const ua = String(userAgent || '');
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/CriOS\//.test(ua)) return 'Chrome';
  if (/FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return /Mobile/i.test(ua) ? 'Mobile' : 'Browser';
};

const gpuRenderer = () => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) || 'unknown';
  } catch { return 'unknown'; }
};

const canvasSignal = () => {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.textBaseline = 'top'; context.font = '16px Arial';
    context.fillStyle = '#c2410c'; context.fillRect(2, 2, 40, 18);
    context.fillStyle = '#0a1428'; context.fillText('Advanced Pro أ', 4, 4);
    return canvas.toDataURL();
  } catch { return 'unavailable'; }
};

export async function collectDeviceDna() {
  const ua = navigator.userAgent || '';
  let clientHints = { platform: navigator.userAgentData?.platform || '', mobile: navigator.userAgentData?.mobile, maxTouchPoints: navigator.maxTouchPoints || 0 };
  try {
    if (navigator.userAgentData?.getHighEntropyValues) clientHints = { ...clientHints, ...(await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion'])) };
    clientHints.brands = navigator.userAgentData?.brands || [];
  } catch {}
  const deviceInfo = parseDetailedDeviceInfo(ua, clientHints);
  const platform = platformFamily(ua);
  const screenShape = [Math.max(screen.width, screen.height), Math.min(screen.width, screen.height)].join('x');
  const dprBucket = (Math.round((window.devicePixelRatio || 1) * 4) / 4).toFixed(2);
  const cores = String(navigator.hardwareConcurrency || 0);
  const audio = (() => {
    try { const context = new (window.AudioContext || window.webkitAudioContext)(); const value = `${context.sampleRate}:${context.destination.maxChannelCount}`; context.close(); return value; }
    catch { return 'unavailable'; }
  })();
  const raw = { gpu: gpuRenderer(), screen: screenShape, platform, dpr: dprBucket, cores };
  const entries = await Promise.all(Object.entries(raw).map(async ([key, value]) => [key, await sha256(`${key}:${value}`)]));
  const physicalSignals = Object.fromEntries(entries);
  const physicalCoreDna = await sha256(Object.keys(physicalSignals).sort().map(key => physicalSignals[key]).join('|'));
  const browserDna = await sha256([ua, canvasSignal(), audio].join('|'));
  return { physicalCoreDna, browserDna, physicalSignals, deviceName: deviceInfo.label, deviceInfo, clientHints };
}

