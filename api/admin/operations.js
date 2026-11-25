import { allowedAdmin, tokenFromRequest } from './_auth.js';
import disputeReportHandler from '../../lib/dispute-report-api.js';

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

export default async function handler(request, response) {
  if (request.query?._route === 'dispute-report') return disputeReportHandler(request, response);
  if (!(await requireAdmin(request))) return response.status(401).json({ message: 'جلسة غير صالحة.' });
  if (request.method === 'GET') {
    const [capacity, rotations, mappings, settings, mailLogs, stores, orders, accounts, mailSecurityEvents] = await Promise.all([
      db('admin_capacity_radar?select=*'), db('admin_password_rotation_queue?select=*'),
      db('salla_product_mappings?select=*&order=created_at.desc'), db('system_settings?select=*&singleton=eq.true'),
      db('mail_delivery_logs?select=recipient_address,category,received_at,email_accounts(mailbox_alias)&order=received_at.desc&limit=5'),
      db('stores?select=id&order=created_at.asc&limit=1'),
      db('orders?select=id,order_number,service_type,customer_phone,status,created_at,starts_at,expires_at,acknowledged_at,tracking_token,security_strikes,locked_device_name,registered_city_name,registered_country_code,free_resets_remaining,account_assignments(email_accounts(id,mailbox_alias,integrity_status,integrity_alerted_at))&order=created_at.desc&limit=100'),
      db('email_accounts?select=id,mailbox_alias,service_type,max_slots,is_active,archived_at,password_updated_at,integrity_status,integrity_alerted_at&order=created_at.desc&limit=200'),
      db('mail_security_events?select=id,event_type,received_at,suspected_order_id,attribution_basis,email_accounts(mailbox_alias)&order=received_at.desc&limit=100'),
    ]);
    if (!capacity.ok || !rotations.ok || !mappings.ok || !settings.ok || !mailLogs.ok || !stores.ok || !orders.ok || !accounts.ok || !mailSecurityEvents.ok) return response.status(502).json({ message: 'تعذر تحميل بيانات التشغيل.' });
    return response.status(200).json({ capacity: await capacity.json(), rotations: await rotations.json(), mappings: await mappings.json(), settings: (await settings.json())[0] || {}, mailLogs: await mailLogs.json(), storeId: (await stores.json())[0]?.id || null, orders: await orders.json(), accounts: await accounts.json(), mailSecurityEvents: await mailSecurityEvents.json() });
  }
  if (request.method === 'POST') {
    const { action, emailAccountId, mapping, settings, bulk } = request.body || {};
    let result;
    if (action === 'save_mapping') {
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
    } else if (action === 'save_settings') {
      result = await db('system_settings?singleton=eq.true', { method: 'PATCH', body: JSON.stringify({ banner_active: Boolean(settings?.banner_active), banner_message: settings?.banner_message || null, auto_assignment_paused: Boolean(settings?.auto_assignment_paused), updated_at: new Date().toISOString() }) });
    } else if (action === 'bulk_import') {
      const aliases = String(bulk?.entries || '').split(/\r?\n/).map(line => line.trim().split(/[,:]/)[0].trim().toLowerCase()).filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
      if (!bulk?.storeId || !aliases.length) return response.status(400).json({ message: 'أدخل بريدًا صالحًا واحدًا على الأقل.' });
      result = await db('rpc/bulk_import_email_accounts', { method: 'POST', body: JSON.stringify({ p_store_id: bulk.storeId, p_service_type: bulk.serviceType, p_max_slots: Number(bulk.maxSlots) || 1, p_aliases: aliases }) });
      if (result.ok) return response.status(200).json({ report: (await result.json())[0], ignoredCredentials: true });
    } else if (action === 'archive_expired') {
      result = await db('rpc/archive_expired_email_accounts', { method: 'POST', body: '{}' });
      if (result.ok) return response.status(200).json({ archived: await result.json() });
    } else {
      if (!emailAccountId) return response.status(400).json({ message: 'معرّف الحساب مطلوب.' });
      result = await db('rpc/confirm_password_rotation', { method: 'POST', body: JSON.stringify({ p_email_account_id: emailAccountId }) });
    }
    return result.ok ? response.status(204).end() : response.status(502).json({ message: 'تعذر تأكيد التحديث.' });
  }
  return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
}
