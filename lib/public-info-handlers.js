import { normalizeMaintenanceSettings } from './maintenance-mode.js';

export async function handlePublicReviews(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method not allowed' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(200).json({ reviews: [] });
  const result = await fetch(`${url}/rest/v1/order_reviews?select=customer_name,product_name,rating,comment,created_at&status=eq.published&rating=eq.5&order=reviewed_at.desc&limit=5`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!result.ok) return response.status(200).json({ reviews: [] });
  const rows = await result.json();
  return response.status(200).setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').json({ reviews: rows.map(row => ({ ...row, customer_name: String(row.customer_name || 'عميلنا').trim().split(/\s+/)[0] })) });
}

export async function handlePublicSettings(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ message: 'الخدمة قيد التهيئة.' });
  const result = await fetch(`${url}/rest/v1/system_settings?select=*&singleton=eq.true`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!result.ok) return response.status(502).json({ message: 'تعذر تحميل الإعدادات.' });
  const [settings] = await result.json(), maintenance = normalizeMaintenanceSettings(settings);
  return response.status(200).setHeader('Cache-Control', 'private, max-age=30').json({ bannerActive: Boolean(settings?.banner_active), bannerMessage: settings?.banner_active ? settings.banner_message : null, autoAssignmentPaused: Boolean(settings?.auto_assignment_paused), maintenanceEnabled: maintenance.enabled, maintenanceMessage: maintenance.message, supportWhatsapp: String(settings?.support_whatsapp || '').replace(/\D/g, '').slice(0, 20) || null });
}
