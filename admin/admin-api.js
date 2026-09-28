const ADMIN_API='/api/admin';
function adminToken(){return ''; }
async function adminFetch(path,opts={}){opts.credentials='include';opts.headers={...(opts.headers||{}),'Content-Type':'application/json'};const r=await fetch(ADMIN_API+path,opts);const d=await r.json();if(r.status===401){location.href='login.html';throw new Error('unauthorized')}if(!r.ok)throw new Error(d.error||'request_failed');return d;}
async function adminLogin(email,password,code){const r=await fetch(ADMIN_API+'/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,code})});const d=await r.json();if(!r.ok)throw new Error(d.error||'invalid');return d;}
async function adminLogout(){try{await fetch(ADMIN_API+'/logout',{method:'POST',credentials:'include'});}catch(_){}if(window.SafeAdmin?.clearSessionProfile)SafeAdmin.clearSessionProfile();localStorage.removeItem('safepays_portal');location.href='login.html';}

async function getMaintenanceSettings(){
  try{return await adminFetch('/maintenance');}
  catch(e){if(e?.message==='unauthorized')throw e;try{return {maintenance:JSON.parse(localStorage.getItem('safepays_maintenance_v1')||'{\"site\":{\"enabled\":false},\"panel\":{\"enabled\":false}}')}}catch(_){throw e}}
}
async function saveMaintenanceSettings(payload){
  try{return await adminFetch('/maintenance',{method:'POST',body:JSON.stringify(payload)});}
  catch(e){if(e?.message==='unauthorized')throw e;localStorage.setItem('safepays_maintenance_v1',JSON.stringify(payload));return {ok:true,maintenance:payload,localOnly:true};}
}
