import { createHmac } from 'node:crypto';

export function normalizeTotpSecret(value) {
  const secret = String(value || '').toUpperCase().replace(/\s+/g, '').replace(/=+$/g, '');
  if (!secret) return '';
  if (!/^[A-Z2-7]{16,128}$/.test(secret)) throw new Error('مفتاح 2FA يجب أن يكون Base32 صالحًا من 16 إلى 128 حرفًا.');
  return secret;
}

export function decodeBase32(value) {
  const secret = normalizeTotpSecret(value);
  let bits = '';
  for (const character of secret) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character).toString(2).padStart(5, '0');
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotp(secret, options = {}) {
  const period = Math.min(Math.max(Number(options.period) || 30, 1), 300);
  const digits = Math.min(Math.max(Number(options.digits) || 6, 6), 10);
  const timestamp = Number.isFinite(Number(options.timestamp)) ? Number(options.timestamp) : Date.now();
  const counter = BigInt(Math.floor(timestamp / 1000 / period));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  const code = String(binary % (10 ** digits)).padStart(digits, '0');
  const secondsRemaining = period - (Math.floor(timestamp / 1000) % period);
  return { code, seconds_remaining: secondsRemaining, period };
}

