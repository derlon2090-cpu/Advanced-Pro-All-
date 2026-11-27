import { allowedAdmin, configured, setSession, supabaseConfig } from "../../lib/admin-auth.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ message: "الطريقة غير مسموحة." });
  if (!configured()) return response.status(503).json({ message: "لم تُضبط بيانات Supabase أو قائمة المشرفين بعد." });
  const { email, password } = request.body || {};
  if (typeof email !== "string" || typeof password !== "string") return response.status(400).json({ message: "بيانات الدخول غير مكتملة." });
  const supabase = supabaseConfig();
  const auth = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: supabase.key, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await auth.json().catch(() => ({}));
  if (!auth.ok || !body.access_token) return response.status(401).json({ message: "بيانات الدخول غير صحيحة أو الحساب غير مفعّل." });
  if (!allowedAdmin(body.user?.email || email)) return response.status(403).json({ message: "هذا الحساب غير مصرح له بالدخول إلى لوحة الإدارة." });
  setSession(response, body.access_token, body.expires_in);
  return response.status(200).json({ ok: true });
}
