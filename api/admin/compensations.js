import { allowedAdmin, tokenFromRequest } from './_auth.js';
import { sendOperationalEmail } from '../../lib/operational-email.js';
const db=(path,options={})=>{const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;return fetch(`${url}/rest/v1/${path}`,{...options,headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json',...(options.headers||{})}})};
async function authorized(request){const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,token=tokenFromRequest(request);if(!url||!anon||!token)return false;const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:anon,authorization:`Bearer ${decodeURIComponent(token)}`}}),u=await r.json().catch(()=>({}));return r.ok&&u.email&&allowedAdmin(u.email)}
export default async function handler(request,response){
  if(!(await authorized(request)))return response.status(401).json({message:'جلسة غير صالحة.'});
  if(request.method!=='PATCH')return response.status(405).json({message:'الطريقة غير مسموحة.'});
  const id=/^[0-9a-f-]{36}$/i.test(String(request.query?.id||''))?String(request.query.id):null,decision=String(request.body?.decision||'');
  if(!id||!['approve','reject'].includes(decision))return response.status(400).json({message:'بيانات القرار غير صالحة.'});
  const result=await db('rpc/admin_resolve_compensation',{method:'POST',body:JSON.stringify({p_request_id:id,p_approve:decision==='approve'})});
  if(!result.ok)return response.status(502).json({message:'تعذر حفظ قرار التعويض.'});const [resolved]=await result.json();
  if(resolved?.success){const q=await db(`compensation_requests?select=customer_email,orders(order_number,tracking_token)&id=eq.${encodeURIComponent(id)}&limit=1`);const [item]=q.ok?await q.json():[];if(item?.customer_email){const o=Array.isArray(item.orders)?item.orders[0]:item.orders,portal=`${process.env.APP_BASE_URL||process.env.NEXT_PUBLIC_APP_URL||'https://ok-phi-ten.vercel.app'}/track/${encodeURIComponent(o?.tracking_token||'')}`,approved=decision==='approve';await sendOperationalEmail({to:item.customer_email,subject:approved?`تم اعتماد تعويض الطلب #${o?.order_number}`:`تحديث طلب تعويض #${o?.order_number}`,html:`<div dir="rtl"><p>${approved?'تم اعتماد التعويض وتفعيل الحساب البديل.':'تمت مراجعة الطلب ولم يُعتمد التعويض.'}</p>${approved?`<a href="${portal}">فتح بطاقة الاشتراك</a>`:''}</div>`,text:approved?`تم اعتماد التعويض. ${portal}`:'تمت مراجعة طلب التعويض ولم يُعتمد.'}).catch(()=>null)}return response.status(200).json(resolved)}
  return response.status(409).json({message:resolved?.reason==='no_healthy_capacity'?'لا يوجد مقعد سليم متاح حاليًا.':'تعذر معالجة الطلب.'});
}
