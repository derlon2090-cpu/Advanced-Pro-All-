import { createHmac, timingSafeEqual } from 'node:crypto';
import { insertUnknownSallaProduct, serviceFromProduct } from '../../lib/salla-products.js';
import { htmlEscape, sendOperationalEmail } from '../../lib/operational-email.js';
import { servicePortalUrl } from '../../lib/service-portal.js';

const json = (response, status, body) => response.status(status).json(body);
const supabaseUrl = () => process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabase = (path, options = {}) => fetch(`${supabaseUrl()}/rest/v1/${path}`, {
  ...options,
  headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...(options.headers || {}) },
});
async function productMapping(productId) {
  if (!productId) return null;
  const params = new URLSearchParams({ select: 'service_type,duration_days,has_warranty,warranty_days,acknowledgment_text,renewal_url,renewal_discount_code', salla_product_id: `eq.${productId}`, limit: '1' });
  const response = await supabase(`salla_product_mappings?${params}`);
  if (!response.ok) return null;
  return (await response.json())[0] || null;
}
async function assignmentPaused() {
  const response = await supabase('system_settings?select=auto_assignment_paused&singleton=eq.true&limit=1');
  if (!response.ok) return false;
  return Boolean((await response.json())[0]?.auto_assignment_paused);
}
async function sendWhatsApp({ phone, orderNumber, trackingToken, serviceType, referralCode }) {
  if (!process.env.WHATSAPP_API_URL || !process.env.WHATSAPP_API_TOKEN || !phone || !trackingToken) return false;
  const portal = servicePortalUrl(serviceType, trackingToken), referral = referralCode ? `https://advpro.app/?ref=${encodeURIComponent(referralCode)}` : '';
  const message = `أهلاً بك في بوابة أدفانسد برو ✨\nرقم طلبك: ${orderNumber}\nبوابة خدمتك: ${portal}${referral ? `\nرابط دعوتك: ${referral}` : ''}\nتنبيه: الاشتراك مخصص لجهاز ومتصفح واحد.`;
  const response = await fetch(process.env.WHATSAPP_API_URL, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ to: phone, message }),
  });
  return response.ok;
}
async function sendOnboardingEmail({ email, name, orderNumber, trackingToken, serviceType, referralCode }) {
  if (!email || !trackingToken) return false;
  const portal=servicePortalUrl(serviceType,trackingToken),referral=referralCode?`https://advpro.app/?ref=${encodeURIComponent(referralCode)}`:null;
  await sendOperationalEmail({to:email,subject:`تم تفعيل طلبك #${orderNumber} فورًا`,html:`<div dir="rtl" style="background:#07152b;color:#f8fafc;padding:26px;border-radius:18px"><h2 style="color:#fb923c">أهلًا ${htmlEscape(name||'عميلنا العزيز')} ✨</h2><p>تم تسكين وتفعيل طلبك <strong>#${htmlEscape(orderNumber)}</strong> آليًا.</p><p><a style="display:inline-block;background:#ea580c;color:white;padding:12px 18px;border-radius:10px;text-decoration:none" href="${htmlEscape(portal)}">فتح بوابة خدمتك</a></p>${referral?`<p>ابدأ دعوة أصدقائك: <a style="color:#fb923c" href="${htmlEscape(referral)}">${htmlEscape(referral)}</a></p>`:''}</div>`,text:`تم تفعيل طلبك #${orderNumber}. بوابة خدمتك: ${portal}${referral?`\nرابط دعوتك: ${referral}`:''}`});
  return true;
}
function signatureValid(request) {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  if (!secret) return false;
  const supplied = request.headers['x-salla-signature'] || request.headers['x-webhook-signature'] || '';
  const expected = createHmac('sha256', secret).update(JSON.stringify(request.body || {})).digest('hex');
  return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed' });
  if (!supabaseUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json(response, 503, { error: 'Server is not configured' });
  if (!signatureValid(request)) return json(response, 401, { error: 'Invalid signature' });
  const payload = request.body || {}, event = request.headers['x-salla-event'] || payload.event || payload.type;
  if (!['order.created', 'order.updated', 'order.payment.updated', 'order.coupon.updated'].includes(event)) return json(response, 202, { ignored: true });
  const order = payload.data || payload.order || payload;
  const couponUsed=String(order.coupon?.code||order.coupon_code||'').trim().toUpperCase();
  if(couponUsed&&event==='order.coupon.updated')await supabase(`referral_coupons?code=eq.${encodeURIComponent(couponUsed)}`,{method:'PATCH',body:JSON.stringify({status:'used',used_at:new Date().toISOString()})}).catch(()=>null);
  const paymentStatus=String(order.payment_status?.slug||order.payment_status||order.payment?.status||order.status?.slug||order.status||'').toLowerCase();
  if (!['paid', 'completed'].includes(paymentStatus)) return json(response, 202, { ignored: true, reason: 'order_not_paid', couponUpdated:Boolean(couponUsed) });
  const items = Array.isArray(order.items) && order.items.length ? order.items : [order.product || {}];
  const item = items[0] || {};
  const productName = item.product?.name || item.name || order.product_name || '';
  const productId = String(item.product?.id || item.id || item.product_id || item.sku || order.product_id || order.sku || '');
  let mapping = await productMapping(productId), productAutoAdded = false;
  for (const orderItem of items) {
    const synced = await insertUnknownSallaProduct(supabase, orderItem).catch(() => null);
    productAutoAdded = Boolean(synced?.inserted) || productAutoAdded;
  }
  if (!mapping && productId) mapping = await productMapping(productId);
  const fallbackDuration = /(?:2\s*month|شهرين|60\s*يوم)/i.test(productName) ? 60 : /(?:3\s*month|3\s*أشهر|90\s*يوم)/i.test(productName) ? 90 : 30;
  const args = {
    p_event_id: String(request.headers['x-salla-event-id'] || payload.event_id || payload.id || `${event}:${order.id}`),
    p_merchant_id: String(payload.merchant?.id || order.merchant_id || process.env.SALLA_MERCHANT_ID || ''),
    p_store_name: payload.merchant?.name || payload.store?.name || 'Salla', p_order_id: String(order.id),
    p_order_number: String(order.reference_id || order.number || order.id), p_customer_id: String(order.customer?.id || order.customer_id || 'unknown'),
    p_customer_name: order.customer?.name || '', p_customer_phone: order.customer?.mobile || order.customer?.phone || '',
    p_product_name: productName, p_service_type: mapping?.service_type || serviceFromProduct(productName),
    p_duration_days: mapping?.duration_days || fallbackDuration,
    p_has_warranty: mapping?.has_warranty !== false,
    p_warranty_days: mapping?.has_warranty === false ? 0 : (mapping?.warranty_days || mapping?.duration_days || fallbackDuration),
    p_acknowledgment_text: mapping?.acknowledgment_text || null,
  };
  if (!args.p_merchant_id || !args.p_order_id) return json(response, 400, { error: 'Missing merchant or order identifier' });
  const ingest = await supabase('rpc/ingest_salla_paid_order', { method: 'POST', body: JSON.stringify(args) });
  if (!ingest.ok) return json(response, 502, { error: 'Order ingestion failed' });
  const orderId = await ingest.json();
  if (!orderId) return json(response, 200, { accepted: true, duplicate: true });
  const customerEmail = String(order.customer?.email || order.customer_email || '').trim().toLowerCase();
  if (mapping?.renewal_url || mapping?.renewal_discount_code || customerEmail) {
    await supabase(`orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        renewal_url: mapping?.renewal_url || null,
        renewal_discount_code: String(mapping?.renewal_discount_code || '').trim().slice(0, 80) || null,
        customer_email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail) ? customerEmail : null,
        updated_at: new Date().toISOString(),
      }),
    });
  }
  if (await assignmentPaused()) return json(response, 200, { accepted: true, assigned: false, pendingAssignment: true, paused: true });
  const assigned = await supabase('rpc/assign_order_to_available_account', { method: 'POST', body: JSON.stringify({ p_order_id: orderId }) });
  if (!assigned.ok) return json(response, 502, { error: 'Assignment failed' });
  const [result] = await assigned.json();
  const wasAssigned = Boolean(result?.assigned);
  let whatsappSent=false,emailSent=false;
  if(wasAssigned){
    const now=new Date().toISOString();
    await supabase(`orders?id=eq.${encodeURIComponent(orderId)}`,{method:'PATCH',body:JSON.stringify({auto_provisioned_at:now,provisioning_source:'salla_webhook',updated_at:now})});
    const onboarding=await supabase(`orders?id=eq.${encodeURIComponent(orderId)}&onboarding_sent_at=is.null`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({onboarding_sent_at:now})});
    const [fresh]=onboarding.ok?await onboarding.json():[];
    if(fresh){
      whatsappSent=await sendWhatsApp({phone:args.p_customer_phone,orderNumber:args.p_order_number,trackingToken:result?.tracking_token,serviceType:args.p_service_type,referralCode:fresh.referral_code}).catch(()=>false);
      emailSent=await sendOnboardingEmail({email:customerEmail,name:args.p_customer_name,orderNumber:args.p_order_number,trackingToken:result?.tracking_token,serviceType:args.p_service_type,referralCode:fresh.referral_code}).catch(()=>false);
    }
  }
  return json(response, 200, { accepted: true, assigned: wasAssigned, pendingAssignment: !wasAssigned, productMappingUsed: Boolean(mapping), productAutoAdded, whatsappSent, emailSent, portalUrl:wasAssigned?servicePortalUrl(args.p_service_type,result?.tracking_token):null });
}
