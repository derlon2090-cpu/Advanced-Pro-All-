import { createHash } from "node:crypto";

const normalizeAddress = value => String(value || "").trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
async function resolveAccount(candidates) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  for (const mailbox of candidates) {
    const query = new URLSearchParams({ select: "id,mailbox_alias", mailbox_alias: `eq.${mailbox}`, is_active: 'eq.true', archived_at: 'is.null', limit: '1' });
    const response = await fetch(`${url}/rest/v1/email_accounts?${query}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    if (response.ok) { const [account] = await response.json(); if (account) return account; }
  }
  return null;
}
async function logDelivery({ messageId, recipient, accountId, senderDomain, category }) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/mail_delivery_logs`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ provider_message_id: messageId, recipient_address: recipient, email_account_id: accountId || null, sender_domain: senderDomain, category }) });
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const expected = process.env.INBOUND_EMAIL_SECRET;
  const auth = request.headers.authorization || "";
  if (!expected || auth !== `Bearer ${expected}`) return response.status(401).json({ error: "Unauthorized" });

  const { messageId, to, envelopeTo, forwardedTo, from, subject, textBody } = request.body || {};
  if (!messageId || !to || !from) return response.status(400).json({ error: "Missing email envelope data" });

  // Intentionally retain classification metadata only. Raw bodies, OTPs,
  // approval URLs, reset links, and credentials are never stored or returned.
  const inspected = `${subject || ""}\n${textBody || ""}`.slice(0, 4000).toLowerCase();
  const passwordChanged = /password (?:was )?changed|your password has been changed|تم تغيير كلمة المرور|تغيّرت كلمة المرور/.test(inspected);
  const emailChanged = /email (?:was )?changed|email address changed|تم تغيير البريد|تغيير عنوان البريد/.test(inspected);
  const logoutAll = /logged out of all|signed out of all|all devices.*signed out|تسجيل الخروج من جميع|الخروج من جميع الأجهزة/.test(inspected);
  const unusualSignin = /unusual (?:login|sign.in)|new (?:login|device)|دخول غير معتاد|جهاز جديد/.test(inspected);
  const blocked = passwordChanged || emailChanged || logoutAll;
  const serviceType = /crunchyroll/.test(inspected) ? "crunchyroll" : /chatgpt|openai/.test(inspected) ? "chatgpt" : "general_subscription";
  const isVerification = /verification code|security code|one.time code|رمز التحقق|رمز التأكيد/.test(inspected);
  const isLogin = /new (login|device)|login verification|verify|sign-in|تأكيد دخول|جهاز جديد/.test(inspected);
  const category = blocked ? "critical_blocked" : isVerification ? "verification_code" : isLogin ? "approved_login" : "unmatched_email";
  const candidates = [...new Set([to, envelopeTo, ...(Array.isArray(forwardedTo) ? forwardedTo : [])].map(normalizeAddress).filter(value => value.includes('@')))];
  const account = await resolveAccount(candidates);
  const recipient = account?.mailbox_alias || candidates[0] || normalizeAddress(to);
  const senderDomain = String(from).split("@").pop()?.toLowerCase() || null;
  await logDelivery({ messageId, recipient, accountId: account?.id, senderDomain, category });
  let securityEvent = null;
  const eventType = passwordChanged ? 'password_changed' : emailChanged ? 'email_changed' : logoutAll ? 'logout_all' : unusualSignin ? 'unusual_signin' : null;
  if (eventType && account?.id && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Correlate only metadata and timing. A recent portal visit is a review
    // lead, not proof that the customer caused the external account change.
    const subjectHash = createHash("sha256").update(String(subject || "")).digest("hex");
    const result = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/record_mail_security_event`, {
      method: "POST",
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_provider_message_id: messageId, p_email_account_id: account.id, p_event_type: eventType, p_sender_domain: senderDomain, p_subject_hash: subjectHash }),
    });
    if (result.ok) securityEvent = (await result.json())[0] || null;
  }
  const payload = {
    accepted: true,
    messageId,
    serviceType,
    category,
    securityEvent: securityEvent ? { recorded: true, reviewCandidateFound: Boolean(securityEvent.suspected_order_id) } : null,
    customerVisible: false,
    bodyInspectedChars: Math.min(String(textBody || "").length, 4000)
  };
  return response.status(202).json(payload);
}
