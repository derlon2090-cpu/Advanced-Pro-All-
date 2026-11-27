import { allowedAdmin, configured, tokenFromRequest, supabaseConfig } from "../../lib/admin-auth.js";
import { enforceAdminHost } from "../../lib/host-routing.js";

export default async function handler(request, response) {
  if (enforceAdminHost(request, response)) return;
  if (request.method !== "GET") return response.status(405).json({ message: "الطريقة غير مسموحة." });
  if (!configured()) return response.status(503).json({ message: "Supabase غير مهيأ." });
  const token = tokenFromRequest(request);
  if (!token) return response.status(401).json({ message: "جلسة غير موجودة." });
  const supabase = supabaseConfig();
  const auth = await fetch(`${supabase.url}/auth/v1/user`, { headers: { apikey: supabase.key, authorization: `Bearer ${decodeURIComponent(token)}` } });
  const user = await auth.json().catch(() => ({}));
  if (!auth.ok || !user.email || !allowedAdmin(user.email)) return response.status(401).json({ message: "جلسة غير صالحة." });
  return response.status(200).json({ email: user.email });
}
