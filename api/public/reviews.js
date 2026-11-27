export default async function handler(request,response){
  if(request.method!=='GET')return response.status(405).json({message:'Method not allowed'});
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return response.status(200).json({reviews:[]});
  const result=await fetch(`${url}/rest/v1/order_reviews?select=customer_name,product_name,rating,comment,created_at&status=eq.published&rating=eq.5&order=reviewed_at.desc&limit=5`,{headers:{apikey:key,authorization:`Bearer ${key}`}});
  if(!result.ok)return response.status(200).json({reviews:[]});
  const rows=await result.json();
  return response.status(200).setHeader('Cache-Control','public, max-age=60, stale-while-revalidate=300').json({reviews:rows.map(row=>({...row,customer_name:String(row.customer_name||'عميلنا').trim().split(/\s+/)[0]}))});
}
