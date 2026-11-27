import tls from 'node:tls';
import { decryptPassword } from './account-credentials.js';
import { generateTotp } from './totp.js';

const imapCommand = (socket, command, tag, timeoutMs = 7000) => new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => done(new Error('imap_timeout')), timeoutMs);
  const done = error => { clearTimeout(timer); socket.off('data', onData); error ? reject(error) : resolve(buffer); };
  const onData = chunk => { buffer += chunk.toString('utf8'); if (new RegExp(`(?:^|\r?\n)${tag} (?:OK|NO|BAD)`, 'i').test(buffer)) done(/(?:^|\r?\n)\S+ OK/i.test(buffer) ? null : new Error('imap_rejected')); };
  socket.on('data', onData); socket.write(`${tag} ${command}\r\n`);
});

export async function pingImapAccount(account) {
  const connection = account?.encrypted_connection || {}, imap = connection.imap || {};
  const host = String(imap.host || connection.imap_host || '').trim(), user = String(imap.user || connection.imap_user || account?.mailbox_alias || '').trim();
  const encryptedPassword = imap.password || connection.imap_password;
  const password = decryptPassword(encryptedPassword);
  if (!host || !user || !password) return { ok: null, reason: 'imap_not_configured' };
  const port = Math.min(Math.max(Number(imap.port || connection.imap_port) || 993, 1), 65535);
  const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
  try {
    await new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(new Error('imap_connect_timeout')),7000); socket.once('secureConnect',()=>{clearTimeout(timer);resolve()}); socket.once('error',error=>{clearTimeout(timer);reject(error)}); });
    const escaped = value => `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
    await imapCommand(socket, `LOGIN ${escaped(user)} ${escaped(password)}`, 'A001');
    await imapCommand(socket, 'NOOP', 'A002');
    socket.write('A003 LOGOUT\r\n');
    return { ok: true };
  } catch (error) { return { ok: false, reason: String(error.message || error).slice(0, 120) }; }
  finally { socket.destroy(); }
}

export function checkTotpAccount(account) {
  if (account?.service_type !== 'chatgpt') return { ok: null, reason: 'not_chatgpt' };
  if (!account.totp_secret) return { ok: false, reason: 'totp_not_configured' };
  try { const result=generateTotp(account.totp_secret); return /^\d{6}$/.test(result.code) ? { ok: true } : { ok: false, reason: 'totp_invalid' }; }
  catch { return { ok: false, reason: 'totp_invalid' }; }
}
