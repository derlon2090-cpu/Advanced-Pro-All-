const cleanText = (value, limit = 500) => String(value || '').trim().slice(0, limit);
const escapeHtml = value => cleanText(value, 2000).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeHttps = value => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; } };

export function renewalStage(daysRemaining) {
  if (daysRemaining <= 1) return '1d';
  if (daysRemaining <= 3) return '3d';
  return 'manual';
}

export function renewalEmail({ order, daysRemaining, baseUrl }) {
  const customer = escapeHtml(order.customer_name || 'عميلنا العزيز');
  const product = escapeHtml(order.product_name || 'اشتراكك الرقمي');
  const number = escapeHtml(order.order_number);
  const remaining = Number(daysRemaining);
  const expiryText = remaining > 1 ? `سينتهي خلال ${remaining} أيام` : remaining === 1 ? 'سينتهي خلال يوم واحد' : 'انتهت مدته';
  const renewalUrl = safeHttps(order.renewal_url) || safeHttps(order.renewal_store_url) || safeHttps(baseUrl) || '#';
  const portalUrl = order.tracking_token && safeHttps(baseUrl) ? `${new URL(baseUrl).origin}/track/${encodeURIComponent(order.tracking_token)}` : safeHttps(baseUrl) || '#';
  const discount = cleanText(order.renewal_discount_code, 80);
  const discountHtml = discount ? `<div style="margin:18px 0;padding:13px;border:1px dashed #fb923c;border-radius:12px;color:#fed7aa">كود خصم التجديد: <strong style="font-size:18px">${escapeHtml(discount)}</strong></div>` : '';
  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#050a18;font-family:Tahoma,Arial,sans-serif;color:#f8fafc"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050a18;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#0f172a;border:1px solid #253754;border-radius:20px;overflow:hidden"><tr><td style="padding:24px;background:linear-gradient(135deg,#9a3412,#ea580c)"><strong style="font-size:21px">بوابة أدفانسد برو</strong><div style="margin-top:6px;color:#ffedd5">تذكير تجديد الاشتراك</div></td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:22px">مرحبًا ${customer} 👋</h1><p style="margin:0;color:#cbd5e1;line-height:1.9">نذكّرك بأن اشتراكك في <strong style="color:#fff">${product}</strong> للطلب <strong style="color:#fb923c">#${number}</strong> ${expiryText}. جدّد الآن لتفادي انقطاع الخدمة.</p>${discountHtml}<a href="${escapeHtml(renewalUrl)}" style="display:block;margin:22px 0 11px;padding:14px;border-radius:12px;background:#ea580c;color:#fff;text-align:center;text-decoration:none;font-weight:bold">جدّد اشتراكك الآن بضغطة واحدة</a><a href="${escapeHtml(portalUrl)}" style="display:block;padding:13px;border:1px solid #334155;border-radius:12px;color:#e2e8f0;text-align:center;text-decoration:none">عرض بطاقة اشتراكي في البوابة</a><p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.7">هذه رسالة تشغيلية مرتبطة بطلبك. لا نطلب منك إرسال كلمات مرور أو رموز تحقق.</p></td></tr></table></td></tr></table></body></html>`;
  const text = `مرحبًا ${order.customer_name || 'عميلنا العزيز'}، اشتراكك في ${order.product_name || 'اشتراكك الرقمي'} للطلب #${order.order_number} ${expiryText}. للتجديد: ${renewalUrl}${discount ? ` — كود الخصم: ${discount}` : ''}. بطاقة الاشتراك: ${portalUrl}`;
  return { html, text, subject: `تذكير تجديد اشتراكك — الطلب #${cleanText(order.order_number, 80)}` };
}

export async function sendRenewalEmail({ order, daysRemaining, baseUrl }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY غير مضبوط.');
  if (!order.customer_email) throw new Error('لا يوجد بريد عميل مسجل لهذا الطلب.');
  const content = renewalEmail({ order, daysRemaining, baseUrl });
  const fromEmail = cleanText(process.env.RESEND_FROM_EMAIL || 'noreply@advproportal.com', 200);
  const fromName = cleanText(process.env.RESEND_FROM_NAME || 'بوابة أدفانسد برو', 100);
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [order.customer_email], subject: content.subject, html: content.html, text: content.text }),
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.message || 'تعذر إرسال بريد التجديد.');
  return payload.id || null;
}
