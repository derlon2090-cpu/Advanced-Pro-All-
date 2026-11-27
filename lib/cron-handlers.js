import { renewalStage, sendRenewalEmail } from './renewal-email.js';
import { htmlEscape, sendOperationalEmail } from './operational-email.js';
import { pingImapAccount, checkTotpAccount } from './inventory-health.js';

const json = (response, status, body) => response.status(status).setHeader('Cache-Control', 'no-store').json(body);
const db = (path, options = {}) => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${url}/rest/v1/${path}`, { ...options, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(options.headers || {}) } });
};
const authorized = request => Boolean(process.env.CRON_SECRET && request.headers.authorization === `Bearer ${process.env.CRON_SECRET}`);
const notifyAdmin = ({ dedupeKey, severity='info', title, message, source='cron', entityType=null, entityId=null }) => db('admin_notifications?on_conflict=dedupe_key', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify({ dedupe_key:dedupeKey, severity, title, message, source, entity_type:entityType, entity_id:entityId, read_at:null, updated_at:new Date().toISOString() }) });

export async function renewalReminders(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
  if (!authorized(request)) return json(response, 401, { error: 'Unauthorized' });
  if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return json(response, 503, { error: 'Server is not configured' });
  const settingsResponse = await db('system_settings?select=renewal_reminders_enabled,renewal_reminder_days,renewal_store_url&singleton=eq.true&limit=1');
  if (!settingsResponse.ok) return json(response, 502, { error: 'Settings query failed' });
  const [settings] = await settingsResponse.json();
  if (!settings?.renewal_reminders_enabled) return json(response, 200, { processed: 0, sent: 0, skipped: true, reason: 'disabled' });
  const stages = Array.isArray(settings.renewal_reminder_days) ? settings.renewal_reminder_days.map(Number).filter(day => day === 3 || day === 1) : [3, 1];
  const maxDays = Math.max(...stages, 1), now = new Date(), end = new Date(now.getTime() + (maxDays + 1) * 86400000);
  const params = new URLSearchParams({ select: 'id,order_number,product_name,customer_email,reminder_email,expires_at,tracking_token,renewal_url,renewal_discount_code,renewal_reminder_3d_sent_at,renewal_reminder_1d_sent_at,customers(name)', status: 'eq.delivered', or: '(customer_email.not.is.null,reminder_email.not.is.null)', expires_at: `gte.${now.toISOString()}` });
  params.append('expires_at', `lt.${end.toISOString()}`);
  const ordersResponse = await db(`orders?${params}`);
  if (!ordersResponse.ok) return json(response, 502, { error: 'Renewal query failed' });
  const orders = await ordersResponse.json(), results = [];
  for (const order of orders) {
    const daysRemaining = Math.max(0, Math.ceil((new Date(order.expires_at) - now) / 86400000)), stage = renewalStage(daysRemaining), stageDay = stage === '3d' ? 3 : stage === '1d' ? 1 : 0;
    if (!stages.includes(stageDay)) continue;
    const column = stage === '3d' ? 'renewal_reminder_3d_sent_at' : 'renewal_reminder_1d_sent_at';
    if (order[column]) { results.push({ orderNumber: order.order_number, stage, status: 'already_sent' }); continue; }
    try {
      order.customer_name = Array.isArray(order.customers) ? order.customers[0]?.name : order.customers?.name; order.customer_email = order.reminder_email || order.customer_email; order.renewal_store_url = settings.renewal_store_url || null;
      await sendRenewalEmail({ order, daysRemaining, baseUrl: process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://advpro.app' });
      const sentAt = new Date().toISOString(), saved = await db(`orders?id=eq.${encodeURIComponent(order.id)}&${column}=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ [column]: sentAt, updated_at: sentAt }) });
      if (!saved.ok) throw new Error('Delivery state could not be saved');
      results.push({ orderNumber: order.order_number, stage, status: 'sent' });
    } catch (error) { results.push({ orderNumber: order.order_number, stage, status: 'failed', error: String(error.message || error).slice(0, 180) }); }
  }
  return json(response, 200, { processed: orders.length, sent: results.filter(item => item.status === 'sent').length, failed: results.filter(item => item.status === 'failed').length, results });
}

export async function mailRetention(request, response) {
  if (!authorized(request)) return response.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ error: 'Server is not configured' });
  const options = { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' };
  const [mail, nonces] = await Promise.all([fetch(`${url}/rest/v1/rpc/cleanup_expired_mail_metadata`, options), fetch(`${url}/rest/v1/rpc/cleanup_expired_device_nonces`, options)]);
  return mail.ok && nonces.ok ? response.status(200).json({ cleanedMail: await mail.json(), cleanedDeviceNonces: await nonces.json() }) : response.status(502).json({ error: 'Cleanup failed' });
}

export async function inventoryHealth(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
  if (!authorized(request)) return json(response, 401, { error: 'Unauthorized' });
  const accountsResponse=await db('email_accounts?select=id,mailbox_alias,service_type,is_active,operational_status,subscription_expires_at,encrypted_connection,totp_secret&is_active=eq.true&archived_at=is.null&limit=500');
  if(!accountsResponse.ok)return json(response,502,{error:'Inventory query failed'});
  const accounts=await accountsResponse.json(),results=[],alerts=[];
  for(const account of accounts){
    let reason=null,status='healthy';
    if(account.subscription_expires_at&&new Date(account.subscription_expires_at)<=new Date())reason='subscription_expired';
    if(!reason&&account.service_type==='chatgpt'){const totp=checkTotpAccount(account);if(totp.ok===false)reason=totp.reason}
    if(!reason&&account.service_type==='crunchyroll'){const imap=await pingImapAccount(account);if(imap.ok===false)reason=imap.reason;else if(imap.ok===null)status='imap_not_configured'}
    const quarantine=Boolean(reason),now=new Date().toISOString();
    const saved=await db(`email_accounts?id=eq.${encodeURIComponent(account.id)}`,{method:'PATCH',body:JSON.stringify({operational_status:quarantine?'quarantined':'available',health_checked_at:now,health_failure_reason:reason||(status==='imap_not_configured'?status:null)})});
    if(quarantine){
      alerts.push(`${account.mailbox_alias}: ${reason}`);
      await db('audit_logs',{method:'POST',body:JSON.stringify({actor_type:'cron',action:'inventory_account_quarantined',entity_type:'email_account',entity_id:account.id,metadata:{reason}})}).catch(()=>null);
      await notifyAdmin({dedupeKey:`inventory:${account.id}:${reason}`,severity:'critical',title:'تم حجر حساب من المخزون',message:`${account.mailbox_alias} — ${reason}`,source:'inventory-health',entityType:'email_account',entityId:account.id}).catch(()=>null);
    }
    results.push({account:account.mailbox_alias,status:quarantine?'quarantined':status,saved:saved.ok});
  }
  const since=new Date(Date.now()-86400000).toISOString(),[capacityResponse,salesResponse]=await Promise.all([db('admin_capacity_radar?select=service_type,available_slots'),db(`orders?select=service_type&created_at=gte.${encodeURIComponent(since)}&payment_status=eq.paid`)]);
  const capacity=capacityResponse.ok?await capacityResponse.json():[],sales=salesResponse.ok?await salesResponse.json():[],stockAlerts=[];
  for(const item of capacity){const sold=sales.filter(order=>order.service_type===item.service_type).length,available=Number(item.available_slots||0);if(sold>0&&available<=sold){const message=`مخزون ${item.service_type}: ${available} مقاعد فقط مقابل ${sold} طلبات خلال 24 ساعة.`;stockAlerts.push(message);await notifyAdmin({dedupeKey:`stock:${item.service_type}:${new Date().toISOString().slice(0,10)}`,severity:'warning',title:'تنبيه انخفاض المخزون',message,source:'inventory-health'}).catch(()=>null)}}
  return json(response,200,{checked:accounts.length,quarantined:alerts.length,stockAlerts,results});
}

export async function dailyDigest(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });
  if (!authorized(request)) return response.status(401).json({ error: 'Unauthorized' });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), start = new Date(`${today}T00:00:00+03:00`).toISOString();
  const [settings, orders, events, reviews, compensations, coupons, capacity] = await Promise.all([db('system_settings?select=digest_email&singleton=eq.true&limit=1'), db(`orders?select=id,status,service_type,auto_provisioned_at,security_strikes,created_at,renewal_reminder_3d_sent_at,renewal_reminder_1d_sent_at,renewal_reminder_manual_sent_at&updated_at=gte.${encodeURIComponent(start)}`), db(`mail_security_events?select=id,event_type,received_at&received_at=gte.${encodeURIComponent(start)}`), db(`order_reviews?select=id&status=eq.pending&created_at=gte.${encodeURIComponent(start)}`),db(`compensation_requests?select=id,status,review_mode&created_at=gte.${encodeURIComponent(start)}`),db(`referral_coupons?select=id&created_at=gte.${encodeURIComponent(start)}`),db('admin_capacity_radar?select=service_type,available_slots')]);
  const [config] = settings.ok ? await settings.json() : [], orderRows = orders.ok ? await orders.json() : [], eventRows = events.ok ? await events.json() : [], reviewRows = reviews.ok ? await reviews.json() : [],compensationRows=compensations.ok?await compensations.json():[],couponRows=coupons.ok?await coupons.json():[],capacityRows=capacity.ok?await capacity.json():[];
  const sentToday = value => value && new Date(value) >= new Date(start), delivered = orderRows.filter(order => order.status === 'delivered').length, reminders = orderRows.reduce((count, order) => count + [order.renewal_reminder_3d_sent_at, order.renewal_reminder_1d_sent_at, order.renewal_reminder_manual_sent_at].filter(sentToday).length, 0), strikes = orderRows.reduce((count, order) => count + Number(order.security_strikes || 0), 0), securityTotal = eventRows.length + strikes, to = config?.digest_email || process.env.EXECUTIVE_DIGEST_EMAIL;
  const autoDelivered=orderRows.filter(order=>order.auto_provisioned_at).length,autoClaims=compensationRows.filter(item=>item.status==='approved'&&item.review_mode==='auto_approved').length,pendingClaims=compensationRows.filter(item=>item.status==='submitted').length,stock=capacityRows.map(item=>`${item.service_type}: ${Number(item.available_slots||0)}`).join('، ');
  const text = `ملخص ${today}\nالتسليم الآلي: ${autoDelivered}\nالتعويضات: ${autoClaims} آلي / ${pendingClaims} قيد المراجعة\nأكواد الدعوات: ${couponRows.length}\nالمخزون: ${stock||'غير متاح'}\nتنبيهات الأمان: ${securityTotal}`;
  await notifyAdmin({dedupeKey:`daily-digest:${today}`,severity:'info',title:`الملخص التنفيذي — ${today}`,message:text,source:'daily-digest'}).catch(()=>null);
  if(to)await sendOperationalEmail({ to, subject: `الملخص التنفيذي اليومي — ${today}`, html: `<div dir="rtl"><h2>الملخص التنفيذي اليومي</h2><p>${htmlEscape(text).replace(/\n/g,'<br>')}</p></div>`, text });
  return response.status(200).json({ sent:true,emailSent:Boolean(to),dashboardNotification:true,autoDelivered,autoClaims,pendingClaims,coupons:couponRows.length,stock });
}
