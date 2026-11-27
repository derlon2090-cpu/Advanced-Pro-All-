import { randomBytes } from 'node:crypto';
import { htmlEscape, sendOperationalEmail } from './operational-email.js';
import { servicePortalUrl } from './service-portal.js';

const dbConfig = () => ({ url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const db = (path, options = {}) => {
  const { url, key } = dbConfig();
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const couponCode = orderNumber => `ADVPRO-${String(orderNumber || 'ORDER').replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}-${randomBytes(3).toString('hex').slice(0, 4).toUpperCase()}`;
const dateOnly = date => date.toISOString().slice(0, 10);

export const buildSallaCouponPayload = ({ code, type, amount, expiryDays }) => ({
  code,
  type: type === 'fixed' ? 'fixed' : 'percentage',
  amount: Number(amount),
  free_shipping: false,
  start_date: dateOnly(new Date()),
  expiry_date: dateOnly(new Date(Date.now() + Number(expiryDays) * 86400000)),
  exclude_sale_products: false,
  is_apply_with_offer: false,
  applied_in: 'all',
  usage_limit: 1,
  usage_limit_per_user: 1,
});

export async function issueReferralCoupon({ referrerOrderId, milestone }) {
  if (!referrerOrderId || !Number.isInteger(Number(milestone)) || Number(milestone) < 1) return { issued: false, reason: 'invalid_milestone' };
  const [orderResponse, settingsResponse] = await Promise.all([
    db(`orders?select=id,order_number,service_type,tracking_token,customer_email,reminder_email,customers(name)&id=eq.${encodeURIComponent(referrerOrderId)}&limit=1`),
    db('system_settings?select=referral_coupon_enabled,referral_coupon_type,referral_coupon_amount,referral_coupon_expiry_days,referral_coupon_discount_label&singleton=eq.true&limit=1'),
  ]);
  if (!orderResponse.ok || !settingsResponse.ok) return { issued: false, reason: 'query_failed' };
  const [order] = await orderResponse.json(), [settings] = await settingsResponse.json();
  if (!order || settings?.referral_coupon_enabled === false) return { issued: false, reason: 'disabled' };
  const existing = await db(`referral_coupons?select=id,code,status&salla_coupon_id=not.is.null&referrer_order_id=eq.${encodeURIComponent(referrerOrderId)}&milestone=eq.${Number(milestone)}&limit=1`);
  const [already] = existing.ok ? await existing.json() : [];
  if (already) return { issued: false, reason: 'already_issued', coupon: already.code };
  const code = couponCode(order.order_number), expiryDays = Math.min(Math.max(Number(settings?.referral_coupon_expiry_days) || 14, 1), 365);
  const reserved = await db('referral_coupons?on_conflict=referrer_order_id,milestone', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ referrer_order_id: referrerOrderId, milestone: Number(milestone), code, status: 'pending', expiry_date: new Date(Date.now() + expiryDays * 86400000).toISOString() }),
  });
  if (!reserved.ok) return { issued: false, reason: 'reservation_failed' };
  const [reservation] = await reserved.json();
  const payload = buildSallaCouponPayload({ code: reservation.code, type: settings?.referral_coupon_type, amount: settings?.referral_coupon_amount || 25, expiryDays });
  if (!process.env.SALLA_ACCESS_TOKEN) {
    await db(`referral_coupons?id=eq.${reservation.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', failure_reason: 'SALLA_ACCESS_TOKEN_missing' }) });
    return { issued: false, reason: 'salla_token_missing' };
  }
  const salla = await fetch('https://api.salla.dev/admin/v2/coupons', { method: 'POST', headers: { authorization: `Bearer ${process.env.SALLA_ACCESS_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
  const result = await salla.json().catch(() => ({}));
  if (!salla.ok || !result?.data?.id) {
    await db(`referral_coupons?id=eq.${reservation.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', failure_reason: String(result?.message || `salla_${salla.status}`).slice(0, 300) }) });
    return { issued: false, reason: 'salla_rejected' };
  }
  const now = new Date().toISOString();
  await Promise.all([
    db(`referral_coupons?id=eq.${reservation.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active', salla_coupon_id: String(result.data.id), issued_at: now, failure_reason: null }) }),
    db(`orders?id=eq.${encodeURIComponent(referrerOrderId)}`, { method: 'PATCH', body: JSON.stringify({ referral_coupon_unlocked_at: now, referral_assigned_coupon: reservation.code, updated_at: now }) }),
  ]);
  const to = order.reminder_email || order.customer_email, customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;
  if (to) {
    const portal = servicePortalUrl(order.service_type, order.tracking_token);
    await sendOperationalEmail({ to, subject: `مبروك! كود خصم جديد ${reservation.code}`, html: `<div dir="rtl"><h2>مبروك ${htmlEscape(customer?.name || 'سفير أدفانسد برو')} 🎉</h2><p>اكتملت دورة الدعوات رقم ${Number(milestone)} وأصدرنا لك كود سلة صالحًا لاستخدام واحد.</p><p style="font-size:24px"><strong>${htmlEscape(reservation.code)}</strong></p><p><a href="${htmlEscape(portal)}">فتح بطاقتك ومتابعة الدورة التالية</a></p></div>`, text: `اكتملت دورة الدعوات رقم ${Number(milestone)}. كودك: ${reservation.code} — صالح لاستخدام واحد. ${portal}` }).catch(() => null);
  }
  return { issued: true, coupon: reservation.code, sallaCouponId: String(result.data.id), payload };
}
