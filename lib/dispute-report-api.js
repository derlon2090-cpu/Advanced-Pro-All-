import { allowedAdmin, tokenFromRequest } from './admin-auth.js';

async function requireAdmin(request) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token = tokenFromRequest(request);
  if (!url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY || !token) return false;
  const result = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${decodeURIComponent(token)}` } });
  const user = await result.json().catch(() => ({}));
  return result.ok && user.email && allowedAdmin(user.email);
}
const db = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, ...(options.headers || {}) } });
};
const cleanId = value => /^[0-9a-f-]{36}$/i.test(String(value || '')) ? String(value) : null;
const stamp = value => value ? new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(value)) : 'غير مسجل';
const decisionLabel = value => ({ registered: 'تسجيل الجهاز الأساسي', trusted_exact: 'دخول من الجهاز المطابق', trusted_fuzzy: 'نفس الجهاز مع اختلاف برمجي بسيط', self_transfer: 'نقل ذاتي موثق للجهاز', blocked_confirmed: 'محاولة جهاز مختلف مؤكدة', blocked_existing_lock: 'محاولة بعد القفل الأمني', transfer_offered: 'عرض نقل جهاز دون تسجيل مخالفة' }[value] || value);

export default async function handler(request, response) {
  if (!(await requireAdmin(request))) return response.status(401).json({ message: 'جلسة غير صالحة.' });
  if (request.method !== 'GET') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  const orderId = cleanId(request.query?.orderId);
  if (!orderId) return response.status(400).json({ message: 'معرّف الطلب غير صالح.' });
  const orderQuery = new URLSearchParams({ select: 'id,order_number,product_name,service_type,status,created_at,starts_at,acknowledged_at,security_strikes,locked_device_name,registered_city_name,registered_country_code,free_resets_remaining,account_assignments(email_accounts(id,mailbox_alias,integrity_status,integrity_alerted_at))', id: `eq.${orderId}`, limit: '1' });
  const [orderResponse, deviceResponse] = await Promise.all([
    db(`orders?${orderQuery}`),
    db(`device_access_events?select=decision,device_name,city_name,country_code,confidence,occurred_at&order_id=eq.${orderId}&order=occurred_at.asc&limit=100`),
  ]);
  if (!orderResponse.ok || !deviceResponse.ok) return response.status(502).json({ message: 'تعذر إنشاء التقرير.' });
  const [order] = await orderResponse.json();
  if (!order) return response.status(404).json({ message: 'الطلب غير موجود.' });
  const deviceEvents = await deviceResponse.json(), account = order.account_assignments?.[0]?.email_accounts || null;
  let mailEvents = [];
  if (account?.id) {
    const mailResponse = await db(`mail_security_events?select=event_type,received_at,suspected_order_id,attribution_basis&email_account_id=eq.${account.id}&order=received_at.asc&limit=100`);
    if (mailResponse.ok) mailEvents = await mailResponse.json();
  }
  const violations = deviceEvents.filter(item => ['blocked_confirmed', 'blocked_existing_lock'].includes(item.decision));
  const integrity = Number(order.security_strikes || 0) === 0 ? 'عميل ملتزم — لا توجد مخالفات أجهزة موثقة' : `تم رصد ${order.security_strikes} مخالفة أجهزة`;
  const lines = [
    'مرحبًا فريق دعم سلة،',
    `نرفق السجل الرقمي الموثق للطلب رقم #${order.order_number}:`,
    '',
    `1. بدأ تسليم الاشتراك بتاريخ ${stamp(order.starts_at || order.created_at)} عبر بوابة أدفانسد برو.`,
    `2. وافق العميل إلكترونيًا على إقرار الاستخدام بتاريخ ${stamp(order.acknowledged_at)}.`,
    `3. الجهاز الأساسي المسجل: ${order.locked_device_name || 'غير مسجل'}${order.registered_city_name ? ` — ${order.registered_city_name}` : ''}${order.registered_country_code ? ` (${order.registered_country_code})` : ''}.`,
    `4. نتيجة سجل النزاهة: ${integrity}.`,
  ];
  if (violations.length) lines.push(`5. المخالفات المؤكدة: ${violations.map(item => `${decisionLabel(item.decision)} من ${item.device_name || 'جهاز مختلف'} بتاريخ ${stamp(item.occurred_at)}${item.city_name ? ` — ${item.city_name}` : ''}${item.country_code ? ` (${item.country_code})` : ''}`).join('؛ ')}.`);
  else lines.push('5. لا يحتوي سجل الجهاز على محاولة تعدد أجهزة مؤكدة؛ ينبغي التعامل مع شكوى العميل كحالة دعم أو تعويض محتملة بعد فحص سلامة الحساب.');
  const relevantMail = mailEvents.filter(item => item.event_type !== 'unusual_signin');
  if (relevantMail.length) lines.push(`6. رصدت البوابة ${relevantMail.length} تنبيه سلامة للحساب المشترك. الارتباط الزمني بأي طلب هو قرينة للمراجعة فقط وليس إثباتًا على هوية من غيّر بيانات الحساب.`);
  lines.push('', 'ملاحظة: لا يخزن التقرير كلمات مرور أو رموز تحقق أو عناوين IP أو محتوى البريد الخام، ويمكن تقديم السجل الزمني الكامل عند الطلب. اسم المدينة مشتق من ترويسة الاستضافة ويُستخدم كقرينة تقريبية لا كإثبات موقع دقيق.');
  return response.status(200).setHeader('Cache-Control', 'private, no-store').json({ report: lines.join('\n'), integrity: { label: integrity, strikes: order.security_strikes || 0, violations: violations.length, accountStatus: account?.integrity_status || 'unknown' }, deviceEvents, mailEvents });
}

