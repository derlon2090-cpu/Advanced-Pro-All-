export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const expected = process.env.INBOUND_EMAIL_SECRET;
  const auth = request.headers.authorization || "";
  if (!expected || auth !== `Bearer ${expected}`) return response.status(401).json({ error: "Unauthorized" });

  const { messageId, to, from, subject, textBody } = request.body || {};
  if (!messageId || !to || !from) return response.status(400).json({ error: "Missing email envelope data" });

  // Intentionally retain only classification metadata. Raw body, OTPs, approval
  // URLs, and credentials are never stored or returned by this endpoint.
  const normalizedSubject = String(subject || "").toLowerCase();
  const serviceType = /crunchyroll/.test(normalizedSubject) ? "crunchyroll" : /chatgpt|openai/.test(normalizedSubject) ? "chatgpt" : "general_subscription";
  const payload = { accepted: true, messageId, serviceType, bodyInspectedChars: Math.min(String(textBody || "").length, 4000) };
  return response.status(202).json(payload);
}
