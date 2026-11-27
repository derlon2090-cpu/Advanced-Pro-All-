export const DEFAULT_MAINTENANCE_MESSAGE = 'نقوم حاليًا بإجراء تحديثات تقنية لتحسين جودة الخدمة في بوابة أدفانسد برو، سنعود للعمل خلال دقائق معدودة.';

export const maintenanceAppliesTo = path => String(path || '').startsWith('/api/public/') && path !== '/api/public/system-settings';

export function normalizeMaintenanceSettings(settings = {}) {
  const hasDedicatedMode = typeof settings.maintenance_enabled === 'boolean';
  return {
    enabled: hasDedicatedMode ? settings.maintenance_enabled : Boolean(settings.banner_active),
    message: String((hasDedicatedMode ? settings.maintenance_message : settings.banner_message) || DEFAULT_MAINTENANCE_MESSAGE).slice(0, 1000),
  };
}

export async function getMaintenanceMode(fetchImpl = fetch) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE };
  const result = await fetchImpl(`${url}/rest/v1/system_settings?select=*&singleton=eq.true&limit=1`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!result.ok) return { enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE };
  const [settings] = await result.json();
  return normalizeMaintenanceSettings(settings);
}

export async function blockForMaintenance(response, fetchImpl = fetch) {
  const maintenance = await getMaintenanceMode(fetchImpl);
  if (!maintenance.enabled) return false;
  response.setHeader('Retry-After', '300');
  response.setHeader('Cache-Control', 'private, no-store');
  response.status(503).json({ maintenance: true, message: maintenance.message });
  return true;
}

