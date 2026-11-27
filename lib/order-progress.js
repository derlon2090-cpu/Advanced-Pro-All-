import { collectDeviceDna, describeDevice } from './device-dna.js';
import { getBindAnchor, saveBindAnchor } from './device-bind-client.js';
import { officialHosts } from './host-routing.js';

const root = document.documentElement;
const card = document.getElementById('orderProgress');
const field = selector => card.querySelector(selector);
const printDevice = info => info.label || 'الجهاز الحالي';
const handoffPattern = /^#open=(\d{1,12}\.[a-f0-9]{64})$/;
const lookupHosts = new Map([
  ['orders', officialHosts.app],
  ['chatgpt', officialHosts.chatgpt],
  ['crunchyroll', officialHosts.crunchyroll],
  ['warranty', officialHosts.compensate],
]);
const verificationRequest = body => json('/api/public/verify-device', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

export function setOrderProgress(stage) {
  if (!stage) { delete root.dataset.orderProgress; return; }
  root.dataset.orderProgress = stage;
  if (stage === 'search') describeDevice().then(({ deviceInfo }) => {
    const pill = field('[data-verification-device]');
    pill.textContent = printDevice(deviceInfo);
    pill.hidden = false;
  }).catch(() => {});
}

async function json(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

export async function previewOrder(token) {
  const { response, data } = await json('/api/public/track?view=verification&token=' + encodeURIComponent(token), { cache: 'no-store' });
  if (!response.ok || !data.order) throw new Error(data.message || 'تعذر العثور على الطلب.');
  return data.order;
}

async function submitVerification(token, dna, handoff) {
  const post = body => verificationRequest({ token, ...body });
  const { response, data } = await post({ action: 'challenge' });
  if (!response.ok || !data.challenge) throw new Error(data.message || 'تعذر بدء التحقق من الجهاز.');
  const bindAnchor = await getBindAnchor(token);
  return post({ ...dna, action: 'verify', challenge: data.challenge, bindAnchor, handoff });
}

function requestMismatchAction(data) {
  field('[data-mismatch-title]').textContent = data.locked ? 'تم إيقاف الوصول لحماية الاشتراك' : 'هذا الطلب موثّق على جهاز ومتصفح آخر';
  const device = field('[data-authorized-device]');
  device.textContent = data.trustedDevice || data.oldDeviceName || '';
  device.parentElement.hidden = !device.textContent;
  field('[data-mismatch-detail]').textContent = data.code === 'GEO_MISMATCH' || data.locked
    ? data.message || 'تواصل مع الدعم لمراجعة حالة الطلب.'
    : 'يرجى فتح الرابط من نفس المتصفح الذي فعّلت منه الاشتراك أول مرة.';
  const other = field('[data-verification-other]');
  setOrderProgress('mismatch');
  other.focus({ preventScroll: true });
  return new Promise(resolve => {
    other.onclick = () => { other.onclick = null; resolve(); };
  });
}

export async function verifyOrderDevice({ token, onOtherOrder, onMismatch, handoff = false }) {
  setOrderProgress('verify');
  const dna = await collectDeviceDna();
  const { response, data } = await submitVerification(token, dna, handoff);
  if (response.ok && data.allowed) {
    if (data.bindAnchor) await saveBindAnchor(token, data.bindAnchor);
    if (!handoff) return true;
    if (!data.proof || !handoffPattern.test('#open=' + data.proof)) throw new Error('تعذر فتح صفحة التفاصيل. أعد الاستعلام.');
    return data.proof;
  }
  if (response.status !== 403) throw new Error(data.message || 'تعذر التحقق من الجهاز.');
  onMismatch?.(data);
  await requestMismatchAction(data);
  setOrderProgress();
  onOtherOrder();
  return false;
}

export async function openOrderDetails({ token, destination, onOtherOrder }) {
  const url = new URL(destination, location.origin);
  const customerHosts = [...lookupHosts.values()];
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(token || '') || url.pathname.split('/').filter(Boolean).at(-1) !== token
    || (url.origin !== location.origin && (url.protocol !== 'https:' || !customerHosts.includes(url.host)))) {
    throw new Error('تعذر تجهيز رابط الطلب. حاول مجددًا.');
  }
  const proof = await verifyOrderDevice({ token, onOtherOrder, handoff: true });
  if (!proof) return false;
  setOrderProgress('success');
  await new Promise(resolve => setTimeout(resolve, 180));
  setOrderProgress('details');
  const source = [...lookupHosts].find(([, host]) => host === location.host)?.[0];
  if (source && url.origin !== location.origin) url.searchParams.set('from', source);
  url.hash = 'open=' + proof;
  location.assign(url);
  return true;
}

export function returnToOrderLookup(fallback = '/') {
  const source = lookupHosts.get(new URL(location.href).searchParams.get('from'));
  location.replace(source ? `https://${source}/` : fallback);
}

export async function resumeOrderDetails(token, endpoint) {
  const proof = location.hash.match(handoffPattern)?.[1];
  if (!proof) return null;
  const url = new URL(location.href);
  url.hash = '';
  history.replaceState(history.state, '', url);
  setOrderProgress('details');
  const { response, data } = await json(endpoint, {
    cache: 'no-store', headers: { 'x-order-details-proof': proof },
  });
  if (response.status === 403 && data.code === 'DETAILS_HANDOFF_REJECTED') return null;
  if (!response.ok) throw new Error(data.message || 'تعذر فتح تفاصيل الطلب.');
  const bindAnchor = response.headers.get('x-device-bind-anchor');
  if (!bindAnchor) return null;
  await saveBindAnchor(token, bindAnchor);
  return data;
}

export async function revealVerified(loadDetails) {
  setOrderProgress('success');
  const delay = new Promise(resolve => setTimeout(resolve, 180)).then(() => setOrderProgress('details'));
  const [details] = await Promise.allSettled([loadDetails(), delay]);
  if (details.status === 'rejected') throw details.reason;
  return details.value;
}

window.addEventListener('pageshow', event => {
  if (event.persisted && ['success', 'details'].includes(root.dataset.orderProgress)) setOrderProgress();
});
