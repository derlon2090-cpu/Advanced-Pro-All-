import { dailyDigest, mailRetention, renewalReminders } from '../lib/cron-handlers.js';

export default function handler(request, response) {
  if (request.query?.job === 'renewal-reminders') return renewalReminders(request, response);
  if (request.query?.job === 'mail-retention') return mailRetention(request, response);
  if (request.query?.job === 'daily-digest') return dailyDigest(request, response);
  return response.status(404).json({ error: 'Unknown cron job' });
}
