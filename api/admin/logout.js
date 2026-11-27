import { clearSession } from "../../lib/admin-auth.js";
import { enforceAdminHost } from "../../lib/host-routing.js";

export default function handler(request, response) {
  if (enforceAdminHost(request, response)) return;
  if (request.method !== "POST") return response.status(405).json({ message: "الطريقة غير مسموحة." });
  clearSession(response);
  return response.status(200).json({ ok: true });
}
