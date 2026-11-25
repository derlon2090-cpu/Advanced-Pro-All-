import { createHash } from "node:crypto";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const expected = process.env.INBOUND_EMAIL_SECRET;
  const auth = request.headers.authorization || "";
  if (!expected || auth !== `Bearer ${expected}`) return response.status(401).json({ error: "Unauthorized" });

  const { messageId, to, from, subject, textBody } = request.body || {};
  if (!messageId || !to || !from) return response.status(400).json({ error: "Missing email envelope data" });

  // Intentionally retain classification metadata only. Raw bodies, OTPs,
  // approval URLs, reset links, and credentials are never stored or returned.
  const inspected = `${subject || ""}\n${textBody || ""}`.slice(0, 4000).toLowerCase();
  const blocked = /password|reset|forgot|change email|email changed|كلمة المرور|إعادة تعيين|تغيير البريد/.test(inspected);
  const serviceType = /crunchyroll/.test(inspected) ? "crunchyroll" : /chatgpt|openai/.test(inspected) ? "chatgpt" : "general_subscription";
  const category = blocked ? "critical_blocked" : /new (login|device)|login verification|verify|sign-in|تأكيد دخول|جهاز جديد/.test(inspected) ? "login_notification" : "unmatched";
  let strike = null;
  if (blocked && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Send only a normalized mailbox and irreversible subject fingerprint to
    // the database. Raw content stays out of the application database.
    const mailbox = String(to).trim().toLowerCase();
    const senderDomain = String(from).split("@").pop()?.toLowerCase() || null;
    const subjectHash = createHash("sha256").update(String(subject || "")).digest("hex");
    const result = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/record_critical_blocked`, {
      method: "POST",
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_provider_message_id: messageId, p_mailbox_alias: mailbox, p_sender_domain: senderDomain, p_subject_hash: subjectHash }),
    });
    if (result.ok) strike = (await result.json())[0] || null;
  }
  const payload = {
    accepted: true,
    messageId,
    serviceType,
    category,
    securityStrike: strike ? { count: strike.security_strikes, suspended: strike.suspended } : null,
    customerVisible: false,
    bodyInspectedChars: Math.min(String(textBody || "").length, 4000)
  };
  return response.status(202).json(payload);
}
