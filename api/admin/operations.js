import { allowedAdmin, tokenFromRequest } from '../../lib/admin-auth.js';
import disputeReportHandler from '../../lib/dispute-report-api.js';
import { handleAdminCompensation, handleAdminReview, handleSallaProductSync } from '../../lib/admin-extra-handlers.js';
import { sendRenewalEmail } from '../../lib/renewal-email.js';
import { createHash, randomBytes } from 'node:crypto';
import { buildCustomerReputations } from '../../lib/customer-reputation.js';
import { encryptPassword } from '../../lib/account-credentials.js';
import { generateTotp, normalizeTotpSecret } from '../../lib/totp.js';
import { htmlEscape, sendOperationalEmail } from '../../lib/operational-email.js';
import { enforceAdminHost } from '../../lib/host-routing.js';
import { servicePortalUrl } from '../../lib/service-portal.js';

async function requireAdmin(request) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, token = tokenFromRequest(request);
  if (!url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY || !token) return false;
  const result = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${decodeURIComponent(token)}` } });
  const user = await result.json().catch(() => ({}));
  return result.ok && user.email && allowedAdmin(user.email);
}
async function db(path, options = {}) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
}

async function loadOrderReviews() {
  const fields = 'id,order_id,order_number,customer_name,product_name,rating,comment,suggestion_category,suggestion_text,status,is_negative,salla_shared_at,created_at,reviewed_at';
  const query = 'order_reviews?order=created_at.desc&limit=500&select=';
  const result = await db(query + fields + ',salla_feedback_id,salla_publish_state,salla_publish_note');
  return result.ok ? result : db(query + fields);
}

export default async function handler(request, response) {
  if (enforceAdminHost(request, response)) return;
  if (request.query?._route === 'dispute-report') return disputeReportHandler(request, response);
  if (!(await requireAdmin(request))) return response.status(401).json({ message: 'جلسة غير صالحة.' });
  if (request.query?._route === 'reviews') return handleAdminReview(request, response);
  if (request.query?._route === 'compensations') return handleAdminCompensation(request, response);
  if (request.query?._route === 'sync-salla') return handleSallaProductSync(request, response);
  if (request.query?._route === 'reset-device') {
    if (request.method !== 'POST') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
    const orderId = /^[0-9a-f-]{36}$/i.test(String(request.query?.orderId || '')) ? String(request.query.orderId) : null;
    if (!orderId) return response.status(400).json({ message: 'معرّف الطلب غير صالح.' });
    const reset = await db('rpc/admin_reset_order_device', { method: 'POST', body: JSON.stringify({ p_order_id: orderId, p_restore_free_reset: request.body?.restoreFreeReset !== false }) });
    if (!reset.ok) return response.status(502).json({ message: 'تعذر تصفير الجهاز.' });
    const [result] = await reset.json();
    return result?.success ? response.status(200).json({ ok: true, freeResetsRemaining: result.free_resets_remaining }) : response.status(404).json({ message: 'الطلب غير موجود.' });
  }
  if (request.method === 'GET') {
    const [capacity, rotations, mappings, settings, mailLogs, stores, orders, accounts, mailSecurityEvents, reviews, compensations, deviceEvents, reauthSessions, referralCoupons, adminNotifications] = await Promise.all([
      db('admin_capacity_radar?select=*'), db('admin_password_rotation_queue?select=*'),
      db('salla_product_mappings?select=*&order=created_at.desc'), db('system_settings?select=*&singleton=eq.true'),
      db('mail_delivery_logs?select=recipient_address,category,received_at,email_accounts(mailbox_alias)&order=received_at.desc&limit=5'),
      db('stores?select=id&order=created_at.asc&limit=1'),
      db('orders?select=id,order_number,product_name,service_type,customer_phone,customer_email,reminder_email,reminder_subscribed_at,status,created_at,starts_at,expires_at,auto_provisioned_at,provisioning_source,has_warranty,warranty_days,warranty_expires_at,acknowledgment_text,acknowledged_at,tracking_token,renewal_url,renewal_discount_code,renewal_reminder_3d_sent_at,renewal_reminder_1d_sent_at,renewal_reminder_manual_sent_at,security_strikes,locked_device_name,registered_city_name,registered_country_code,free_resets_remaining,customers(name),account_assignments(email_accounts(id,mailbox_alias,integrity_status,integrity_alerted_at))&order=created_at.desc&limit=100'),
      db('email_accounts?select=id,mailbox_alias,service_type,max_slots,is_active,archived_at,password_updated_at,integrity_status,integrity_alerted_at,operational_status,subscription_expires_at,health_checked_at,health_failure_reason,encrypted_connection,totp_secret&order=created_at.desc&limit=200'),
      db('mail_security_events?select=id,event_type,received_at,suspected_order_id,attribution_basis,email_accounts(mailbox_alias)&order=received_at.desc&limit=100'),
      loadOrderReviews(),
      db('compensation_requests?select=id,order_id,reason,customer_note,status,review_mode,strikes_at_request,cumulative_strikes,cumulative_orders,cumulative_compensations,reputation_badge,old_email_account_id,replacement_email_account_id,evidence_image_url,evidence_image_hash,device_mismatch_blocked,customer_email,decision_reason,reviewed_at,created_at&order=created_at.desc&limit=500'),
      db('device_access_events?select=order_id,physical_core_hash&order=occurred_at.desc&limit=5000'),
      db(`service_reauth_sessions?select=email_account_id,started_at&started_at=gte.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&limit=5000`),
      db('referral_coupons?select=id,referrer_order_id,milestone,code,salla_coupon_id,status,expiry_date,issued_at,used_at,failure_reason,created_at,orders(order_number,customer_email)&order=created_at.desc&limit=500'),
      db('admin_notifications?select=id,severity,title,message,source,entity_type,entity_id,read_at,created_at&order=created_at.desc&limit=100'),
    ]);
    if (!capacity.ok || !rotations.ok || !mappings.ok || !settings.ok || !mailLogs.ok || !stores.ok || !orders.ok || !accounts.ok || !mailSecurityEvents.ok || !deviceEvents.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات التشغيل.' });
    const orderRows = await orders.json(), compensationRows = compensations.ok ? await compensations.json() : [], deviceRows = await deviceEvents.json(), reviewRows = reviews.ok ? await reviews.json() : [];
    const reauthRows = reauthSessions.ok ? await reauthSessions.json() : [];
    const reauthCounts = reauthRows.reduce((counts, item) => {
      if (item.email_account_id) counts[item.email_account_id] = (counts[item.email_account_id] || 0) + 1;
      return counts;
    }, {});
    const accountRows = (await accounts.json()).map(({ totp_secret, encrypted_connection, ...account }) => {
      const attempts = reauthCounts[account.id] || 0;
      const quarantined = !account.is_active || Boolean(account.archived_at) || account.operational_status === 'quarantined' || (account.integrity_status && account.integrity_status !== 'healthy');
      return {
        ...account,
        totp_configured: Boolean(totp_secret),
        imap_configured: Boolean(encrypted_connection?.imap?.host && encrypted_connection?.imap?.user && encrypted_connection?.imap?.password),
        imap_host: String(encrypted_connection?.imap?.host || '').slice(0, 255) || null,
        imap_user: String(encrypted_connection?.imap?.user || '').slice(0, 254) || null,
        reauth_attempts_24h: attempts,
        health_status: quarantined ? 'quarantined' : attempts > 3 ? 'watch' : 'excellent',
        health_label: quarantined ? 'محجور' : attempts > 3 ? 'تحت المراقبة' : 'ممتاز 100%',
        health_score: quarantined ? 0 : attempts > 3 ? 65 : 100,
      };
    });
    const reputations = buildCustomerReputations(orderRows, compensationRows, deviceRows);
    const enrichedOrders = orderRows.map(order => ({ ...order, customer_reputation: reputations[order.id] }));
    const enrichedCompensations = compensationRows.map(item => ({ ...item, customer_reputation: reputations[item.order_id] }));
    const couponRows=referralCoupons.ok?await referralCoupons.json():[],notificationRows=adminNotifications.ok?await adminNotifications.json():[],deliveredOrders=orderRows.filter(order=>['delivered','active'].includes(order.status)),activeOrders=deliveredOrders.filter(order=>!order.expires_at||new Date(order.expires_at)>new Date()),claimedOrders=new Set(compensationRows.map(item=>item.order_id)),now=Date.now();
    const kpis={instant_delivery_percent:deliveredOrders.length?Math.round(deliveredOrders.filter(order=>order.auto_provisioned_at).length/deliveredOrders.length*100):0,zero_claim_rate_percent:activeOrders.length?Math.round(activeOrders.filter(order=>!claimedOrders.has(order.id)).length/activeOrders.length*100):100,accounts_expiring_72h:accountRows.filter(account=>account.subscription_expires_at&&new Date(account.subscription_expires_at)>new Date()&&new Date(account.subscription_expires_at).getTime()-now<=72*3600000).length,referral_coupons_issued:couponRows.filter(item=>['active','used'].includes(item.status)).length};
    return response.status(200).json({ capacity: await capacity.json(), rotations: await rotations.json(), mappings: await mappings.json(), settings: (await settings.json())[0] || {}, mailLogs: await mailLogs.json(), storeId: (await stores.json())[0]?.id || null, orders: enrichedOrders, accounts: accountRows, mailSecurityEvents: await mailSecurityEvents.json(), reviews: reviewRows, compensations: enrichedCompensations, referralCoupons:couponRows, notifications:notificationRows, unreadNotifications:notificationRows.filter(item=>!item.read_at).length, kpis });
  }
  if (request.method === 'POST') {
    const { action, emailAccountId, orderId, mapping, settings, bulk, manualOrder, newPassword, totpSecret } = request.body || {};
    let result;
    if (action === 'mark_notifications_read') {
      result = await db('admin_notifications?read_at=is.null', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return result.ok ? response.status(200).json({ ok: true }) : response.status(502).json({ message: 'تعذر تحديث حالة التنبيهات.' });
    } else if (action === 'create_manual_order') {
      const clean = {
        orderNumber: String(manualOrder?.order_number || '').trim().slice(0, 80),
        customerName: String(manualOrder?.customer_name || '').trim().slice(0, 120),
        customerPhone: String(manualOrder?.customer_phone || '').replace(/[^0-9+]/g, '').slice(0, 20),
        customerEmail: String(manualOrder?.customer_email || '').trim().toLowerCase().slice(0, 254),
        productName: String(manualOrder?.product_name || '').trim().slice(0, 180),
        serviceType: String(manualOrder?.service_type || ''),
        durationDays: Math.min(Math.max(Number(manualOrder?.duration_days) || 30, 1), 3660),
        hasWarranty: manualOrder?.has_warranty !== false,
        warrantyDays: Math.min(Math.max(Number(manualOrder?.warranty_days) || 30, 1), 3660),
      };
      if (!clean.orderNumber || !clean.customerName || clean.customerPhone.length < 4 || !clean.productName || !['crunchyroll', 'chatgpt', 'general_subscription'].includes(clean.serviceType)) {
        return response.status(400).json({ message: 'أكمل رقم الطلب واسم العميل والجوال والمنتج والخدمة.' });
      }
      if (clean.customerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean.customerEmail)) return response.status(400).json({ message: 'البريد الإلكتروني غير صالح.' });
      const storesResult = await db('stores?select=id&order=created_at.asc&limit=1');
      if (!storesResult.ok) return response.status(502).json({ message: 'تعذر تحديد المتجر.' });
      let [store] = await storesResult.json();
      if (!store?.id) {
        const createdStore = await db('stores?on_conflict=salla_merchant_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({ salla_merchant_id: 'manual-admin-store', name: 'Advanced Pro Portal' }),
        });
        if (!createdStore.ok) return response.status(502).json({ message: 'تعذر تهيئة متجر الطلبات اليدوية.' });
        [store] = await createdStore.json();
      }
      if (!store?.id) return response.status(502).json({ message: 'تعذر تهيئة متجر الطلبات اليدوية.' });
      const duplicate = await db(`orders?select=id&store_id=eq.${encodeURIComponent(store.id)}&order_number=eq.${encodeURIComponent(clean.orderNumber)}&limit=1`);
      if (!duplicate.ok) return response.status(502).json({ message: 'تعذر التحقق من رقم الطلب.' });
      if ((await duplicate.json()).length) return response.status(409).json({ message: 'رقم الطلب موجود مسبقًا.' });
      const customerKey = `manual:${clean.customerPhone.replace(/\D/g, '') || clean.orderNumber}`;
      const customerResult = await db('customers?on_conflict=store_id,salla_customer_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ store_id: store.id, salla_customer_id: customerKey, name: clean.customerName, email: clean.customerEmail || null }),
      });
      if (!customerResult.ok) return response.status(502).json({ message: 'تعذر حفظ بيانات العميل.' });
      const [customer] = await customerResult.json();
      const start = manualOrder?.starts_at && !Number.isNaN(Date.parse(manualOrder.starts_at)) ? new Date(manualOrder.starts_at) : new Date();
      const expires = new Date(start.getTime() + clean.durationDays * 86400000);
      const warrantyExpires = clean.hasWarranty ? new Date(start.getTime() + clean.warrantyDays * 86400000) : null;
      const trackingToken = randomBytes(24).toString('hex');
      const accessTokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
      const acknowledgment = clean.hasWarranty
        ? 'يشمل الضمان التوقف المفاجئ طوال المدة المحددة.\nيُلغى الضمان عند تغيير البريد أو كلمة المرور أو مشاركة الحساب.\nيتم التعويض بعد التحقق من الالتزام بشروط الاستخدام.'
        : 'يُسلّم المنتج بحالة سليمة وقت الشراء.\nهذا المنتج تسليم لمرة واحدة ولا يشمله التعويض بعد التسليم.\nيتحمل العميل مسؤولية حفظ بيانات المنتج بعد استلامه.';
      const orderResult = await db('orders', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ store_id: store.id, customer_id: customer.id, salla_order_id: `manual:${clean.orderNumber}`, order_number: clean.orderNumber, product_name: clean.productName, service_type: clean.serviceType, customer_phone: clean.customerPhone, customer_email: clean.customerEmail || null, payment_status: 'paid', status: 'received', access_token_hash: accessTokenHash, access_token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), tracking_token: trackingToken, duration_days: clean.durationDays, starts_at: start.toISOString(), expires_at: expires.toISOString(), has_warranty: clean.hasWarranty, warranty_days: clean.hasWarranty ? clean.warrantyDays : 0, warranty_expires_at: warrantyExpires?.toISOString() || null, acknowledgment_text: acknowledgment }),
      });
      if (!orderResult.ok) return response.status(502).json({ message: 'تعذر إنشاء الطلب اليدوي.' });
      const [created] = await orderResult.json();
      const assignment = await db('rpc/assign_order_to_available_account', { method: 'POST', body: JSON.stringify({ p_order_id: created.id }) });
      const assignmentData = assignment.ok ? (await assignment.json())[0] : null;
      return response.status(201).json({ ok: true, orderId: created.id, trackingToken: assignmentData?.tracking_token || trackingToken, assigned: Boolean(assignmentData?.assigned) });
    } else if (action === 'send_renewal_reminder') {
      if (!/^[0-9a-f-]{36}$/i.test(String(orderId || ''))) return response.status(400).json({ message: 'معرّف الطلب غير صالح.' });
      const orderResult = await db(`orders?select=id,order_number,product_name,customer_email,reminder_email,expires_at,tracking_token,renewal_url,renewal_discount_code,customers(name)&id=eq.${encodeURIComponent(orderId)}&limit=1`);
      const settingsResult = await db('system_settings?select=renewal_store_url&singleton=eq.true&limit=1');
      if (!orderResult.ok || !settingsResult.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات التجديد.' });
      const [order] = await orderResult.json(), [portalSettings] = await settingsResult.json();
      if (!order) return response.status(404).json({ message: 'الطلب غير موجود.' });
      order.customer_name = Array.isArray(order.customers) ? order.customers[0]?.name : order.customers?.name;
      order.customer_email = order.reminder_email || order.customer_email;
      order.renewal_store_url = portalSettings?.renewal_store_url || null;
      const remaining = order.expires_at ? Math.ceil((new Date(order.expires_at) - Date.now()) / 86400000) : 0;
      await sendRenewalEmail({ order, daysRemaining: remaining, baseUrl: process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://advpro.app' });
      const sentAt = new Date().toISOString();
      const saved = await db(`orders?id=eq.${encodeURIComponent(order.id)}`, { method: 'PATCH', body: JSON.stringify({ renewal_reminder_manual_sent_at: sentAt, updated_at: sentAt }) });
      return saved.ok ? response.status(200).json({ ok: true, sentAt }) : response.status(502).json({ message: 'أُرسل البريد لكن تعذر تسجيل حالته.' });
    } else if (action === 'save_renewal_settings') {
      const days = [...new Set((Array.isArray(settings?.renewal_reminder_days) ? settings.renewal_reminder_days : [3, 1]).map(Number).filter(day => day === 3 || day === 1))].sort((a, b) => b - a);
      result = await db('system_settings?singleton=eq.true', { method: 'PATCH', body: JSON.stringify({ renewal_reminders_enabled: Boolean(settings?.renewal_reminders_enabled), renewal_reminder_days: days.length ? days : [3, 1], updated_at: new Date().toISOString() }) });
    } else if (action === 'save_mapping') {
      if (!mapping?.salla_product_id || !mapping?.service_type) return response.status(400).json({ message: 'رقم المنتج والخدمة مطلوبان.' });
      const hasWarranty = mapping.has_warranty !== false;
      const warrantyDays = hasWarranty ? Math.min(Math.max(Number(mapping.warranty_days) || 30, 1), 3660) : 0;
      const defaultAcknowledgment = hasWarranty
        ? 'يشمل الضمان التوقف المفاجئ طوال المدة المحددة.\nيُلغى الضمان عند تغيير البريد أو كلمة المرور أو مشاركة الحساب.\nيتم التعويض بعد التحقق من الالتزام بشروط الاستخدام.'
        : 'يُسلّم المنتج بحالة سليمة وقت الشراء.\nهذا المنتج تسليم لمرة واحدة ولا يشمله التعويض بعد التسليم.\nيتحمل العميل مسؤولية حفظ بيانات المنتج بعد استلامه.';
      let renewalUrl = null;
      if (mapping.renewal_url) {
        try { const parsed = new URL(String(mapping.renewal_url)); renewalUrl = parsed.protocol === 'https:' ? parsed.toString() : null; } catch {}
        if (!renewalUrl) return response.status(400).json({ message: 'رابط التجديد يجب أن يكون رابط HTTPS صالحًا.' });
      }
      result = await db('salla_product_mappings?on_conflict=salla_product_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ salla_product_id: String(mapping.salla_product_id), product_title: mapping.product_title || null, service_type: mapping.service_type, duration_days: Math.min(Math.max(Number(mapping.duration_days) || 30, 1), 3660), has_warranty: hasWarranty, warranty_days: warrantyDays, acknowledgment_text: String(mapping.acknowledgment_text || defaultAcknowledgment).trim().slice(0, 4000), renewal_url: renewalUrl, renewal_discount_code: String(mapping.renewal_discount_code || '').trim().slice(0, 80) || null, updated_at: new Date().toISOString() }) });
    } else if (action === 'save_delivery_estimate') {
      const defaultDeliveryEstimate = String(settings?.default_delivery_estimate || 'فوري خلال 5 – 18 ساعة').trim().slice(0, 160);
      if (!defaultDeliveryEstimate) return response.status(400).json({ message: 'أدخل الوقت المتوقع للتسليم.' });
      result = await db('system_settings?singleton=eq.true', { method: 'PATCH', body: JSON.stringify({ default_delivery_estimate: defaultDeliveryEstimate, updated_at: new Date().toISOString() }) });
    } else if (action === 'save_referral_settings') {
      const type=settings?.referral_coupon_type==='fixed'?'fixed':'percentage',amount=Math.min(Math.max(Number(settings?.referral_coupon_amount)||25,.01),type==='percentage'?100:100000),expiryDays=Math.min(Math.max(Number(settings?.referral_coupon_expiry_days)||14,1),365);
      result=await db('system_settings?singleton=eq.true',{method:'PATCH',body:JSON.stringify({referral_coupon_type:type,referral_coupon_amount:amount,referral_coupon_expiry_days:expiryDays,updated_at:new Date().toISOString()})});
    } else if (action === 'save_settings') {
      const optionalHttps = (value, label) => {
        const clean = String(value || '').trim();
        if (!clean) return null;
        try { const parsed = new URL(clean); if (parsed.protocol === 'https:') return parsed.toString(); } catch {}
        throw new Error(`${label} يجب أن يكون رابط HTTPS صالحًا.`);
      };
      const portalUrl = (value, label, fallback) => {
        const clean = String(value || fallback || '').trim();
        if (/^\/[a-zA-Z0-9/_-]*$/.test(clean)) return clean;
        return optionalHttps(clean, label);
      };
      let supportWhatsapp, sallaReviewUrl, renewalStoreUrl, crunchyrollPortalUrl, chatgptPortalUrl, upsellUrl;
      try {
        supportWhatsapp = String(settings?.support_whatsapp || '').replace(/[^0-9+]/g, '').slice(0, 20) || null;
        sallaReviewUrl = optionalHttps(settings?.salla_review_url, 'رابط تقييم سلة');
        renewalStoreUrl = optionalHttps(settings?.renewal_store_url, 'رابط المتجر');
        crunchyrollPortalUrl = optionalHttps(settings?.crunchyroll_portal_url, 'رابط بوابة كرانشي رول');
        chatgptPortalUrl = portalUrl(settings?.chatgpt_portal_url, 'رابط بوابة ChatGPT', 'https://gpt.advpro.app');
        upsellUrl = optionalHttps(settings?.upsell_url, 'رابط عرض الترقية');
      } catch (error) { return response.status(400).json({ message: error.message }); }
      const digestEmail=String(settings?.digest_email||'').trim().toLowerCase();if(digestEmail&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(digestEmail))return response.status(400).json({message:'بريد التقرير اليومي غير صالح.'});
      const couponType=settings?.referral_coupon_type==='fixed'?'fixed':'percentage',couponAmount=Math.min(Math.max(Number(settings?.referral_coupon_amount)||25,.01),couponType==='percentage'?100:100000),couponExpiryDays=Math.min(Math.max(Number(settings?.referral_coupon_expiry_days)||14,1),365);
      const settingsUpdate = { banner_active: Boolean(settings?.banner_active), banner_message: String(settings?.banner_message || '').trim().slice(0, 500) || null, auto_assignment_paused: Boolean(settings?.auto_assignment_paused), support_whatsapp: supportWhatsapp, salla_review_url: sallaReviewUrl, renewal_store_url: renewalStoreUrl, crunchyroll_portal_url: crunchyrollPortalUrl, default_delivery_estimate: String(settings?.default_delivery_estimate || 'فوري خلال 5 – 18 ساعة').trim().slice(0, 160) || 'فوري خلال 5 – 18 ساعة', maintenance_enabled: Boolean(settings?.maintenance_enabled), maintenance_message: String(settings?.maintenance_message || 'نقوم حاليًا بإجراء تحديثات تقنية لتحسين جودة الخدمة في بوابة أدفانسد برو، سنعود للعمل خلال دقائق معدودة.').trim().slice(0, 1000), upsell_enabled:Boolean(settings?.upsell_enabled),upsell_title:String(settings?.upsell_title||'').trim().slice(0,160)||null,upsell_description:String(settings?.upsell_description||'').trim().slice(0,500)||null,upsell_url:upsellUrl,upsell_duration_minutes:Math.min(Math.max(Number(settings?.upsell_duration_minutes)||30,1),1440),digest_email:digestEmail||null,referral_coupon_enabled:settings?.referral_coupon_enabled!==false,referral_coupon_target:Math.min(Math.max(Number(settings?.referral_coupon_target)||5,1),100),referral_coupon_code:String(settings?.referral_coupon_code||'ADVVIP5').trim().slice(0,80),referral_coupon_discount_label:String(settings?.referral_coupon_discount_label||'خصم خاص 25% لعملائنا السفراء').trim().slice(0,160),referral_coupon_type:couponType,referral_coupon_amount:couponAmount,referral_coupon_expiry_days:couponExpiryDays, updated_at: new Date().toISOString() };
      settingsUpdate.chatgpt_portal_url = chatgptPortalUrl;
      if (typeof settings?.renewal_reminders_enabled === 'boolean') settingsUpdate.renewal_reminders_enabled = settings.renewal_reminders_enabled;
      if (Array.isArray(settings?.renewal_reminder_days)) settingsUpdate.renewal_reminder_days = [...new Set(settings.renewal_reminder_days.map(Number).filter(day => day >= 1 && day <= 30))].sort((a, b) => b - a).slice(0, 5);
      result = await db('system_settings?singleton=eq.true', { method: 'PATCH', body: JSON.stringify(settingsUpdate) });
      if (!result.ok) {
        const failure = await result.clone().json().catch(() => ({}));
        const missingMaintenanceColumns = /maintenance_(enabled|message)/i.test(String(failure.message || failure.details || '')) || failure.code === 'PGRST204';
        if (missingMaintenanceColumns) {
          const { maintenance_enabled, maintenance_message, default_delivery_estimate, ...legacyUpdate } = settingsUpdate;
          legacyUpdate.banner_active = maintenance_enabled;
          legacyUpdate.banner_message = maintenance_message;
          result = await db('system_settings?singleton=eq.true', { method: 'PATCH', body: JSON.stringify(legacyUpdate) });
        }
      }
    } else if (action === 'save_imap_settings') {
      if(!/^[0-9a-f-]{36}$/i.test(String(emailAccountId||'')))return response.status(400).json({message:'معرّف الحساب غير صالح.'});
      const host=String(settings?.imap_host||'').trim().toLowerCase(),user=String(settings?.imap_user||'').trim(),password=String(settings?.imap_password||''),port=Math.min(Math.max(Number(settings?.imap_port)||993,1),65535);
      if(!/^[a-z0-9.-]+$/.test(host)||host.length>255||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)||password.length<6)return response.status(400).json({message:'أكمل مضيف IMAP والبريد وكلمة مرور تطبيق صالحة.'});
      const found=await db(`email_accounts?select=id,encrypted_connection&id=eq.${encodeURIComponent(emailAccountId)}&limit=1`);const [account]=found.ok?await found.json():[];if(!account)return response.status(404).json({message:'الحساب غير موجود.'});
      const connection={...(account.encrypted_connection||{}),imap:{host,port,user,password:encryptPassword(password)}};
      result=await db(`email_accounts?id=eq.${encodeURIComponent(emailAccountId)}`,{method:'PATCH',body:JSON.stringify({encrypted_connection:connection,operational_status:'available',health_failure_reason:null})});
    } else if (action === 'save_account_expiry') {
      if(!/^[0-9a-f-]{36}$/i.test(String(emailAccountId||'')))return response.status(400).json({message:'معرّف الحساب غير صالح.'});
      const expiry=String(settings?.subscription_expires_at||'').trim();let parsed=null;if(expiry){parsed=new Date(expiry);if(Number.isNaN(parsed.getTime()))return response.status(400).json({message:'تاريخ الانتهاء غير صالح.'})}
      result=await db(`email_accounts?id=eq.${encodeURIComponent(emailAccountId)}`,{method:'PATCH',body:JSON.stringify({subscription_expires_at:parsed?parsed.toISOString():null,operational_status:parsed&&parsed<=new Date()?'quarantined':'available',health_failure_reason:parsed&&parsed<=new Date()?'subscription_expired':null})});
    } else if (action === 'test_totp_secret') {
      let candidate = String(totpSecret || '');
      if (!candidate && emailAccountId) {
        const found = await db(`email_accounts?select=totp_secret&id=eq.${encodeURIComponent(emailAccountId)}&limit=1`);
        if (!found.ok) return response.status(502).json({ message: 'تعذر تحميل إعداد 2FA.' });
        candidate = (await found.json())[0]?.totp_secret || '';
      }
      try {
        const normalized = normalizeTotpSecret(candidate);
        if (!normalized) return response.status(400).json({ message: 'أدخل مفتاح 2FA أولًا.' });
        return response.status(200).setHeader('Cache-Control', 'private, no-store').json(generateTotp(normalized));
      } catch (error) { return response.status(400).json({ message: error.message }); }
    } else if (action === 'save_totp_secret') {
      if (!/^[0-9a-f-]{36}$/i.test(String(emailAccountId || ''))) return response.status(400).json({ message: 'معرّف الحساب غير صالح.' });
      let normalized = null;
      try { normalized = String(totpSecret || '').trim() ? normalizeTotpSecret(totpSecret) : null; }
      catch (error) { return response.status(400).json({ message: error.message }); }
      result = await db(`email_accounts?id=eq.${encodeURIComponent(emailAccountId)}&service_type=eq.chatgpt`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ totp_secret: normalized }) });
      if (!result.ok) return response.status(502).json({ message: 'تعذر حفظ مفتاح 2FA.' });
      if (!(await result.json()).length) return response.status(404).json({ message: 'حساب ChatGPT غير موجود.' });
      return response.status(200).json({ ok: true, configured: Boolean(normalized) });
    } else if (action === 'rotate_password_notify') {
      if(!emailAccountId||String(newPassword||'').length<6||String(newPassword).length>200)return response.status(400).json({message:'أدخل كلمة مرور جديدة من 6 أحرف على الأقل.'});
      let encrypted;try{encrypted=encryptPassword(String(newPassword))}catch(error){return response.status(503).json({message:error.message})}
      const accountResult=await db(`email_accounts?select=id,mailbox_alias,service_type,encrypted_connection&id=eq.${encodeURIComponent(emailAccountId)}&limit=1`);if(!accountResult.ok)return response.status(502).json({message:'تعذر تحميل الحساب.'});const [target]=await accountResult.json();if(!target)return response.status(404).json({message:'الحساب غير موجود.'});
      const updatedConnection={...(target.encrypted_connection||{}),password:encrypted};
      result=await db(`email_accounts?id=eq.${encodeURIComponent(emailAccountId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({encrypted_connection:updatedConnection,password_updated_at:new Date().toISOString(),integrity_status:'healthy',integrity_alerted_at:null})});if(!result.ok)return response.status(502).json({message:'تعذر حفظ كلمة المرور المشفرة.'});
      const subscribers=await db(`account_assignments?select=orders(id,order_number,customer_email,reminder_email,security_strikes,tracking_token,customers(name))&email_account_id=eq.${encodeURIComponent(emailAccountId)}&released_at=is.null`);const rows=subscribers.ok?await subscribers.json():[];let notified=0;
      for(const row of rows){const o=row.orders;if(!o||Number(o.security_strikes||0)>0)continue;const to=o.reminder_email||o.customer_email;if(!to)continue;const name=Array.isArray(o.customers)?o.customers[0]?.name:o.customers?.name,portal=servicePortalUrl(target.service_type,o.tracking_token);try{await sendOperationalEmail({to,subject:`تم تحديث بيانات دخول اشتراكك — الطلب #${o.order_number}`,html:`<div dir="rtl"><h2>مرحبًا ${htmlEscape(name||'عميلنا العزيز')}</h2><p>تم تحديث بيانات الدخول لضمان استمرارية الخدمة. يمكنك نسخها الآن من بوابتك.</p><p><a href="${htmlEscape(portal)}">فتح بوابة الخدمة</a></p></div>`,text:`تم تحديث بيانات دخول الطلب #${o.order_number}. انسخها من بوابتك: ${portal}`});notified++}catch{}
      }
      return response.status(200).json({ok:true,notified,excluded:rows.length-notified});
    } else if (action === 'bulk_import') {
      const entries = String(bulk?.entries || '').split(/\r?\n/).map(line => {
        const [email = '', password = '', secret = ''] = line.split(/[,;|\t]/).map(value => value.trim());
        return { email: email.toLowerCase(), password, secret };
      }).filter(item => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item.email));
      const aliases = entries.map(item => item.email);
      if (!bulk?.storeId || !aliases.length) return response.status(400).json({ message: 'أدخل بريدًا صالحًا واحدًا على الأقل.' });
      if (bulk.serviceType !== 'chatgpt' && entries.some(item => item.secret)) return response.status(400).json({ message: 'مفتاح 2FA متاح لحسابات ChatGPT فقط.' });
      result = await db('rpc/bulk_import_email_accounts', { method: 'POST', body: JSON.stringify({ p_store_id: bulk.storeId, p_service_type: bulk.serviceType, p_max_slots: Number(bulk.maxSlots) || 1, p_aliases: aliases }) });
      if (result.ok) {
        const report = (await result.json())[0];
        let credentialsUpdated = 0;
        for (const entry of entries.filter(item => item.password || item.secret)) {
          const found = await db(`email_accounts?select=id,encrypted_connection&mailbox_alias=eq.${encodeURIComponent(entry.email)}&service_type=eq.${encodeURIComponent(bulk.serviceType)}&limit=1`);
          if (!found.ok) continue;
          const [account] = await found.json();
          if (!account) continue;
          const update = {};
          if (entry.password) {
            try { update.encrypted_connection = { ...(account.encrypted_connection || {}), password: encryptPassword(entry.password) }; update.password_updated_at = new Date().toISOString(); }
            catch { continue; }
          }
          if (entry.secret) {
            try { update.totp_secret = normalizeTotpSecret(entry.secret); }
            catch { continue; }
          }
          const saved = await db(`email_accounts?id=eq.${encodeURIComponent(account.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) });
          if (saved.ok) credentialsUpdated++;
        }
        return response.status(200).json({ report, credentialsUpdated });
      }
    } else if (action === 'archive_expired') {
      result = await db('rpc/archive_expired_email_accounts', { method: 'POST', body: '{}' });
      if (result.ok) return response.status(200).json({ archived: await result.json() });
    } else {
      if (!emailAccountId) return response.status(400).json({ message: 'معرّف الحساب مطلوب.' });
      result = await db('rpc/confirm_password_rotation', { method: 'POST', body: JSON.stringify({ p_email_account_id: emailAccountId }) });
    }
    if (result.ok) return response.status(204).end();
    const failure = await result.json().catch(() => ({}));
    return response.status(502).json({ message: failure.message ? `تعذر حفظ الإعدادات: ${String(failure.message).slice(0, 220)}` : 'تعذر تأكيد التحديث.' });
  }
  return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
}
