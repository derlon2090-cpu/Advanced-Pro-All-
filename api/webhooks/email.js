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
  const payload = {
    accepted: true,
    messageId,
    serviceType,
    category,
    customerVisible: false,
    bodyInspectedChars: Math.min(String(textBody || "").length, 4000)
  };
  return response.status(202).json(payload);
}
