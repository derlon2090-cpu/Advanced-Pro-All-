import { normalizeMaintenanceSettings } from '../../lib/maintenance-mode.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'الطريقة غير مسموحة.' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ message: 'الخدمة قيد التهيئة.' });
  const result = await fetch(`${url}/rest/v1/system_settings?select=*&singleton=eq.true`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!result.ok) return response.status(502).json({ message: 'تعذر تحميل الإعدادات.' });
  const [settings] = await result.json();
  const maintenance = normalizeMaintenanceSettings(settings);
  return response.status(200).setHeader('Cache-Control', 'private, max-age=30').json({
    bannerActive: Boolean(settings?.banner_active),
    bannerMessage: settings?.banner_active ? settings.banner_message : null,
    autoAssignmentPaused: Boolean(settings?.auto_assignment_paused),
    maintenanceEnabled: maintenance.enabled,
    maintenanceMessage: maintenance.message,
    supportWhatsapp: String(settings?.support_whatsapp || '').replace(/\D/g, '').slice(0, 20) || null,
  });
}
