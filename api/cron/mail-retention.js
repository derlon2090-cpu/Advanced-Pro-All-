export default async function handler(request, response) {
  if (!process.env.CRON_SECRET || request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ error: 'Server is not configured' });
  const result = await fetch(`${url}/rest/v1/rpc/cleanup_expired_mail_metadata`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' });
  return result.ok ? response.status(200).json({ cleaned: await result.json() }) : response.status(502).json({ error: 'Cleanup failed' });
}
