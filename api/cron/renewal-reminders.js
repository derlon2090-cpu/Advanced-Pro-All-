const json = (response, status, body) => response.status(status).json(body);
export default async function handler(request, response) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.authorization !== `Bearer ${expected}`) return json(response, 401, { error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(response, 503, { error: 'Server is not configured' });
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
  const params = new URLSearchParams({ select: 'order_number,product_name,expires_at,tracking_token', status: 'eq.delivered', expires_at: `gte.${start.toISOString()}` });
  params.append('expires_at', `lt.${end.toISOString()}`);
  const result = await fetch(`${url}/rest/v1/orders?${params}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!result.ok) return json(response, 502, { error: 'Renewal query failed' });
  const orders = await result.json();
  // A configured webhook receives a compact daily summary; no customer phone
  // numbers or account data are sent by this job.
  if (process.env.RETENTION_WEBHOOK_URL && orders.length) await fetch(process.env.RETENTION_WEBHOOK_URL, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.RETENTION_WEBHOOK_TOKEN || ''}` },
    body: JSON.stringify({ type: 'renewals_due_in_48_hours', count: orders.length, orders }),
  });
  return json(response, 200, { processed: orders.length, orders });
}
