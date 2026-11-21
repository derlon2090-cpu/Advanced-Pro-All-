const page = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Crunchyroll Code Hub</title>
    <style>
      :root { color-scheme: dark; font-family: Tahoma, Arial, sans-serif; --bg:#090a0e; --panel:#15161d; --line:#2d2f39; --muted:#a7a9b5; --orange:#ff6b00; --lime:#56d895; --red:#ff6c78; }
      * { box-sizing:border-box } body { margin:0; min-height:100vh; background:radial-gradient(circle at 87% 0%,#351c0a 0,transparent 32rem),var(--bg); color:#fff; }
      button,input { font:inherit } button { cursor:pointer; border:0 } .shell{max-width:1200px;margin:auto;padding:22px} header{display:flex;justify-content:space-between;align-items:center;padding:10px 0 30px}.brand{display:flex;gap:12px;align-items:center;font-size:1.15rem;font-weight:800}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--orange);color:#111;font-weight:900}.tag{font-size:.78rem;color:var(--muted);font-weight:400}.nav{display:flex;gap:10px}.nav button,.ghost{background:transparent;color:#ddd;border:1px solid var(--line);border-radius:10px;padding:10px 14px}.nav button.active,.primary{background:var(--orange);color:#16100b;font-weight:800;border-radius:10px;padding:11px 17px}.view{display:none}.view.active{display:block}.hero{padding:30px 0 45px;display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:center}.eyebrow{color:#ff9551;font-size:.84rem;font-weight:bold}.hero h1{font-size:clamp(2rem,5vw,4rem);line-height:1.1;margin:10px 0 18px}.hero p{color:var(--muted);font-size:1.05rem;line-height:1.8;max-width:650px}.card{background:linear-gradient(145deg,#1b1c25,#111219);border:1px solid var(--line);border-radius:18px;padding:24px;box-shadow:0 18px 50px #0004}.card h2,.card h3{margin-top:0}.track-card{position:relative;overflow:hidden}.track-card:before{content:'';position:absolute;width:250px;height:250px;background:#ff6b001c;filter:blur(35px);left:-130px;top:-120px}.track-card>*{position:relative}.field{display:flex;flex-direction:column;gap:8px;margin:14px 0}.field label{font-size:.86rem;color:var(--muted)}input{width:100%;color:white;background:#090a0e;border:1px solid #343642;border-radius:10px;padding:13px;outline:0}.inline{display:flex;gap:10px}.inline input{min-width:0}.notice{font-size:.82rem;color:var(--muted);line-height:1.6;margin-top:16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.stat strong{font-size:1.7rem;display:block}.stat span{color:var(--muted);font-size:.85rem}.section-title{display:flex;justify-content:space-between;align-items:end;margin:20px 0}.steps{display:grid;gap:0}.step{display:grid;grid-template-columns:30px 1fr;gap:12px;padding:9px 0;color:var(--muted)}.dot{width:20px;height:20px;border-radius:50%;background:#30323c;border:4px solid #22242e}.done .dot{background:var(--lime)}.current .dot{background:var(--orange);box-shadow:0 0 0 5px #ff6b0026}.done,.current{color:#fff}.order{display:none;margin-top:18px}.order.show{display:block}.status{display:inline-block;background:#55330e;color:#ffb169;padding:6px 9px;border-radius:999px;font-size:.8rem;font-weight:bold}.admin-wrap{max-width:930px;margin:15px auto}.login{max-width:440px;margin:50px auto}.muted{color:var(--muted)}.dashboard{display:none}.dashboard.show{display:block}.adminbar{display:flex;justify-content:space-between;align-items:center;margin:22px 0}.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:right;padding:14px 8px;border-bottom:1px solid var(--line);font-size:.9rem}.pill{border-radius:999px;padding:5px 8px;font-size:.75rem;background:#153729;color:#79e9af}.warning{background:#4b3315;color:#ffc477}.danger{background:#482128;color:#ffadb5}.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.security{border-right:3px solid var(--orange);padding-right:12px;color:#ffd2ae}.small{font-size:.82rem}.footer{padding:42px 0 15px;color:#777;font-size:.83rem;text-align:center}@media(max-width:720px){.shell{padding:16px}.hero,.two{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.nav{gap:5px}.nav button{padding:9px;font-size:.8rem}.hero{padding-top:8px}.table{font-size:.78rem}.table th:nth-child(4),.table td:nth-child(4){display:none}}
    </style>
  </head>
  <body>
   <div class="shell"><header><div class="brand"><span class="mark">C</span><span>Crunchyroll Code Hub <small class="tag">إدارة آمنة للطلبات</small></span></div><nav><button class="active" data-view="customer">متابعة الطلب</button><button data-view="admin">دخول الإدارة</button></nav></header>
   <main>
    <section id="customer" class="view active"><div class="hero"><div><div class="eyebrow">من سلة إلى المتابعة بثقة</div><h1>اطلب، تابع، وأكمل الإجراء الرسمي بأمان.</h1><p>منصة موحّدة لعرض حالة الاشتراك وإشعارات تسجيل الدخول. لا نعرض كلمات مرور أو رموز تحقق أو روابط موافقة خاصة.</p><div class="security small">أي تأكيد أمني يتم من العميل عبر قناة Crunchyroll الرسمية فقط.</div></div><div class="card track-card"><h2>متابعة طلبك</h2><p class="muted small">أدخل رقم الطلب ورمز الوصول الذي وصلك بعد الشراء.</p><div class="field"><label>رقم الطلب</label><input id="orderId" value="SLL-10248" placeholder="مثال: SLL-10248"></div><div class="field"><label>رمز الوصول الآمن</label><input id="accessCode" type="password" value="demo-code" placeholder="••••••••"></div><button class="primary" id="track">عرض حالة الطلب</button><p class="notice">نسخة عرض: استخدم SLL-10248 وأي رمز للاطلاع على النموذج.</p></div></div>
     <div id="order" class="order"><div class="section-title"><div><div class="eyebrow">SLL-10248</div><h2>Crunchyroll Premium – 12 شهرًا</h2></div><span class="status">إجراء أمني مطلوب من العميل</span></div><div class="two"><div class="card"><h3>مراحل التنفيذ</h3><div class="steps"><div class="step done"><span class="dot"></span><span>تم استلام الطلب <small class="muted">• الدفع مؤكد</small></span></div><div class="step done"><span class="dot"></span><span>تم تجهيز الاشتراك</span></div><div class="step current"><span class="dot"></span><span>بانتظار إتمام الإجراء الرسمي</span></div><div class="step"><span class="dot"></span><span>اكتملت المتابعة</span></div></div></div><div class="card"><h3>تنبيه تسجيل دخول</h3><p class="muted">ورد تنبيه بشأن محاولة دخول حديثة مرتبطة بطلبك.</p><p class="small"><b>الوقت:</b> اليوم، 2:30 م<br><b>التفاصيل:</b> لا تُعرض إلا المعلومات العامة التي تسمح بها الرسالة.</p><button class="primary" id="confirm">أكملت الإجراء الرسمي</button><p id="confirmMsg" class="notice"></p></div></div></div>
     <div class="grid" style="margin-top:24px"><div class="card stat"><strong>آمن</strong><span>رموز وصول محدودة المدة</span></div><div class="card stat"><strong>مباشر</strong><span>تحديثات الحالة فورًا</span></div><div class="card stat"><strong>خاص</strong><span>فصل تام بين الطلبات</span></div></div></section>
    <section id="admin" class="view"><div class="admin-wrap"><div id="login" class="card login"><div class="eyebrow">منطقة محمية</div><h2>دخول الإدارة</h2><p class="muted small">الدخول مخصص لمشغّلي المتجر فقط.</p><div class="field"><label>البريد الإداري</label><input id="adminEmail" type="email" placeholder="admin@domain.com"></div><div class="field"><label>كلمة المرور</label><input id="adminPass" type="password" placeholder="••••••••"></div><button id="loginBtn" class="primary">تسجيل الدخول</button><p id="loginMsg" class="notice">يُتحقق من الحساب عبر Supabase Auth ولا تُحفظ كلمة المرور في الموقع.</p></div>
       <div id="dashboard" class="dashboard"><div class="adminbar"><div><div class="eyebrow">لوحة التحكم</div><h2>مرحبًا، مدير المتجر</h2></div><button id="logout" class="ghost">تسجيل الخروج</button></div><div class="grid"><div class="card stat"><strong>128</strong><span>إجمالي الطلبات</span></div><div class="card stat"><strong>11</strong><span>تتطلب إجراء العميل</span></div><div class="card stat"><strong>96%</strong><span>نجاح معالجة البريد</span></div></div><div class="two" style="margin-top:18px"><div class="card"><h3>طلبات تحتاج متابعة</h3><table class="table"><thead><tr><th>الطلب</th><th>العميل</th><th>الحالة</th><th>آخر تحديث</th></tr></thead><tbody><tr><td>SLL-10248</td><td>عميل #813</td><td><span class="pill warning">إجراء أمني</span></td><td>منذ 5 د</td></tr><tr><td>SLL-10241</td><td>عميل #809</td><td><span class="pill">مكتمل</span></td><td>منذ ساعة</td></tr><tr><td>SLL-10237</td><td>عميل #804</td><td><span class="pill danger">معلّق</span></td><td>أمس</td></tr></tbody></table></div><div class="card"><h3>حالة الربط</h3><div class="steps"><div class="step done"><span class="dot"></span><span>Webhook سلة <small class="muted">جاهز للتهيئة</small></span></div><div class="step done"><span class="dot"></span><span>Supabase <small class="muted">مخطط قاعدة البيانات مرفق</small></span></div><div class="step current"><span class="dot"></span><span>البريد الوارد <small class="muted">يتطلب مزود Inbound Email</small></span></div></div><p class="notice">لا تُخزّن بيانات الاعتماد أو محتوى البريد الحساس في المتصفح.</p></div></div></div>
    </section>
   </main><footer class="footer">Crunchyroll Code Hub · لوحة تشغيل مستقلة · واجهة عربية RTL</footer></div>
    <script>
      document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-view]').forEach(x=>x.classList.remove('active')); document.querySelectorAll('.view').forEach(x=>x.classList.remove('active')); button.classList.add('active'); document.querySelector('#'+button.dataset.view).classList.add('active'); }));
      document.querySelector('#track').addEventListener('click', () => document.querySelector('#order').classList.add('show'));
      document.querySelector('#confirm').addEventListener('click', () => document.querySelector('#confirmMsg').textContent='تم تسجيل تأكيد المتابعة. سيُراجع فريق المتجر الحالة دون الوصول إلى أي بيانات حساسة.');
      const loginMessage = document.querySelector('#loginMsg');
      async function restoreAdmin() { const r=await fetch('/api/admin/session'); if(r.ok){document.querySelector('#login').style.display='none';document.querySelector('#dashboard').classList.add('show')} }
      document.querySelector('#loginBtn').addEventListener('click', async () => { const e=document.querySelector('#adminEmail').value, p=document.querySelector('#adminPass').value; if(!e||!p){loginMessage.textContent='أدخل البريد وكلمة المرور.';return} const b=document.querySelector('#loginBtn'); b.disabled=true;b.textContent='جاري التحقق...'; const r=await fetch('/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e,password:p})}); const body=await r.json().catch(()=>({})); if(r.ok){document.querySelector('#login').style.display='none';document.querySelector('#dashboard').classList.add('show')}else{loginMessage.textContent=body.message||'تعذر تسجيل الدخول.'} b.disabled=false;b.textContent='تسجيل الدخول'; });
      document.querySelector('#logout').addEventListener('click', async () => { await fetch('/api/admin/logout',{method:'POST'});document.querySelector('#dashboard').classList.remove('show');document.querySelector('#login').style.display='block'; }); restoreAdmin();
    </script>
  </body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "crunchyroll-code-hub", mode: "configuration-required" });
    }
    if (url.pathname === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
    if (url.pathname === "/api/admin/session" && request.method === "GET") return adminSession(request, env);
    if (url.pathname === "/api/admin/logout" && request.method === "POST") return adminLogout();
    if (url.pathname === "/webhooks/salla" && request.method === "POST") {
      // The production adapter must verify the official Salla signature format before processing.
      // This guard deliberately rejects unconfigured requests, so a webhook is never accepted by accident.
      if (!env.SALLA_WEBHOOK_SECRET) return Response.json({ error: "Salla webhook is not configured" }, { status: 503 });
      const signature = request.headers.get("x-webhook-signature");
      if (!signature) return Response.json({ error: "Missing webhook signature" }, { status: 401 });
      return Response.json({ accepted: false, reason: "Install the verified Salla signature adapter before enabling this endpoint" }, { status: 501 });
    }
    if (url.pathname === "/webhooks/email" && request.method === "POST") {
      if (!env.EMAIL_WEBHOOK_SECRET) return Response.json({ error: "Email webhook is not configured" }, { status: 503 });
      return Response.json({ accepted: false, reason: "Install the provider-specific signature adapter before enabling this endpoint" }, { status: 501 });
    }
    if (url.pathname !== "/") {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    return new Response(page, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};

const sessionName = "__Host-cch_session";

function jsonError(message, status = 400) { return Response.json({ message }, { status }); }
function configured(env) { return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.ADMIN_EMAILS); }
function allowedAdmin(email, env) { return (env.ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase()); }
function cookieValue(request, name) { return (request.headers.get("cookie") || "").split(";").map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1); }

async function adminLogin(request, env) {
  if (!configured(env)) return jsonError("لم تُضبط بيانات Supabase أو قائمة المشرفين في أسرار الموقع بعد.", 503);
  const { email, password } = await request.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") return jsonError("بيانات الدخول غير مكتملة.");
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) return jsonError("بيانات الدخول غير صحيحة أو الحساب غير مفعّل.", 401);
  const signedInEmail = body.user?.email || email;
  if (!allowedAdmin(signedInEmail, env)) return jsonError("هذا الحساب غير مصرح له بالدخول إلى لوحة الإدارة.", 403);
  return Response.json({ ok: true }, { headers: { "set-cookie": `${sessionName}=${encodeURIComponent(body.access_token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.min(Number(body.expires_in || 3600), 3600)}` } });
}

async function adminSession(request, env) {
  if (!configured(env)) return jsonError("Supabase غير مهيأ.", 503);
  const token = cookieValue(request, sessionName);
  if (!token) return jsonError("جلسة غير موجودة.", 401);
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${decodeURIComponent(token)}` } });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user.email || !allowedAdmin(user.email, env)) return jsonError("جلسة غير صالحة.", 401);
  return Response.json({ email: user.email });
}

function adminLogout() { return Response.json({ ok: true }, { headers: { "set-cookie": `${sessionName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } }); }
