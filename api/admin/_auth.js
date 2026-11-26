const sessionName = "__Host-cch_session";

export function configured() {
  return Boolean(supabaseConfig().url && supabaseConfig().key && process.env.ADMIN_EMAILS);
}

export function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function allowedAdmin(email) {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export function tokenFromRequest(request) {
  return (request.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${sessionName}=`))?.slice(sessionName.length + 1);
}

export function setSession(response, token, expiresIn) {
  response.setHeader("Set-Cookie", `${sessionName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.min(Number(expiresIn || 3600), 3600)}`);
}

export function clearSession(response) {
  response.setHeader("Set-Cookie", `${sessionName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
