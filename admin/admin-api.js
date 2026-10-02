const ADMIN_API='/api/admin';
const OWNER_API='/api/owner';
function adminToken(){return '';}
async function adminFetch(path,opts={}){opts.credentials='include';opts.headers={...(opts.headers||{}),'Content-Type':'application/json'};const r=await fetch(ADMIN_API+path,opts);const d=await r.json();if(r.status===401){location.href=location.pathname.includes('/owner/')?'/owner/login.html':'/admin/login.html';throw new Error('unauthorized')}if(!r.ok)throw new Error(d.error||'request_failed');return d;}
async function adminLogin(email,password,code){const r=await fetch(ADMIN_API+'/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,code})});const d=await r.json();if(!r.ok)throw new Error(d.error||'invalid');return d;}
async function ownerLogin(email,password,code){const r=await fetch(OWNER_API+'/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,code})});const d=await r.json();if(!r.ok)throw new Error(d.error||'invalid');return d;}
async function adminLogout(){const owner=location.pathname.includes('/owner/');try{await fetch((owner?OWNER_API:ADMIN_API)+'/logout',{method:'POST',credentials:'include'});}catch(_){}if(window.SafeAdmin?.clearSessionProfile)SafeAdmin.clearSessionProfile();localStorage.removeItem('safepays_portal');location.replace(owner?'/owner/login.html':'/admin/login.html');}
async function getMaintenanceSettings(){return await adminFetch('/maintenance');}
async function saveMaintenanceSettings(payload){return await adminFetch('/maintenance',{method:'POST',body:JSON.stringify(payload)});}
async function findUserByEmail(email){const users=await getUsers();return users.find(u=>u.email.toLowerCase()===email.toLowerCase());}
async function findUserByPhone(phone){return await (await getUsers()).find(u=>normalizePhone(u.phone)===phone);}
async function findUserById(id){return await (await getUsers()).find(u=>u.id===id);}
