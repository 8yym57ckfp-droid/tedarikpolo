const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export default async (request)=>{
  const h=request.headers;
  const forwarded=String(h.get('x-forwarded-for')||'').split(',')[0].trim();
  const ip=String(h.get('x-nf-client-connection-ip')||forwarded||h.get('x-real-ip')||'').trim()||'Alınamadı';
  return json({ok:true,ip});
};
