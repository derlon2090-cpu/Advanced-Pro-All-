import { collectDeviceDna, describeDevice } from './device-dna.js';
import { getBindAnchor, saveBindAnchor } from './device-bind-client.js';

const root = document.documentElement;
const card = document.getElementById('orderProgress');
const field = selector => card.querySelector(selector);
const printDevice = info => info.label || 'الجهاز الحالي';

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

async function submitVerification(token, dna) {
  const endpoint = '/api/public/verify-device';
  const post = body => json(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
  const { response, data } = await post({ action: 'challenge' });
  if (!response.ok || !data.challenge) throw new Error(data.message || 'تعذر بدء التحقق من الجهاز.');
  const bindAnchor = await getBindAnchor(token);
  return post({ ...dna, action: 'verify', challenge: data.challenge, bindAnchor });
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

export async function verifyOrderDevice({ token, onOtherOrder, onMismatch }) {
  setOrderProgress('verify');
  const dna = await collectDeviceDna();
  const { response, data } = await submitVerification(token, dna);
  if (response.ok && data.allowed) {
    if (data.bindAnchor) await saveBindAnchor(token, data.bindAnchor);
    return true;
  }
  if (response.status !== 403) throw new Error(data.message || 'تعذر التحقق من الجهاز.');
  onMismatch?.(data);
  await requestMismatchAction(data);
  setOrderProgress();
  onOtherOrder();
  return false;
}

export async function revealVerified(loadDetails) {
  setOrderProgress('success');
  const delay = new Promise(resolve => setTimeout(resolve, 400)).then(() => setOrderProgress('details'));
  const [details] = await Promise.allSettled([loadDetails(), delay]);
  if (details.status === 'rejected') throw details.reason;
  return details.value;
}
