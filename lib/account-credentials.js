import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const key = () => createHash('sha256').update(String(process.env.ENCRYPTION_KEY || '')).digest();

export function encryptPassword(password) {
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY غير مضبوط.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  return { v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptPassword(payload) {
  try {
    if (!payload?.ciphertext || !process.env.ENCRYPTION_KEY) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}
