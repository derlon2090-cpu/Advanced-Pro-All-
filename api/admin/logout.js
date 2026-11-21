import { clearSession } from "./_auth.js";

export default function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ message: "الطريقة غير مسموحة." });
  clearSession(response);
  return response.status(200).json({ ok: true });
}
