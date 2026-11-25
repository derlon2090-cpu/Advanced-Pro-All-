export default async function handler(request, response) {
  if (!process.env.CRON_SECRET || request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return response.status(503).json({ error: 'Server is not configured' });
  const options = { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' };
  const [mail, nonces] = await Promise.all([
    fetch(`${url}/rest/v1/rpc/cleanup_expired_mail_metadata`, options),
    fetch(`${url}/rest/v1/rpc/cleanup_expired_device_nonces`, options),
  ]);
  return mail.ok && nonces.ok
    ? response.status(200).json({ cleanedMail: await mail.json(), cleanedDeviceNonces: await nonces.json() })
    : response.status(502).json({ error: 'Cleanup failed' });
}
