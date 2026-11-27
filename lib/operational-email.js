const clean = (value, limit = 500) => String(value || '').trim().slice(0, limit);
export const htmlEscape = value => clean(value, 4000).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function sendOperationalEmail({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY || !to) throw new Error('خدمة البريد أو عنوان المستلم غير متاح.');
  const result = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ authorization:`Bearer ${process.env.RESEND_API_KEY}`,'content-type':'application/json' }, body:JSON.stringify({
    from:`${clean(process.env.RESEND_FROM_NAME || 'بوابة أدفانسد برو',100)} <${clean(process.env.RESEND_FROM_EMAIL || 'noreply@advproportal.com',200)}>`,
    to:[clean(to,254)], subject:clean(subject,200), html:String(html || ''), text:String(text || ''),
  }) });
  const payload=await result.json().catch(()=>({})); if(!result.ok) throw new Error(payload.message || 'تعذر إرسال البريد.'); return payload.id || null;
}
