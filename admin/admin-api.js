const ADMIN_API='/api/admin';
const OWNER_API='/api/owner';
function adminToken(){return '';}
function activeAdminApi(){return location.pathname.includes('/owner/')?OWNER_API:ADMIN_API;}
function testRunApiPath(path){return ['/stats','/users','/user-center','/transactions','/transactions/decision','/transactions/lock','/transactions/reopen','/ledger','/finance/reconciliation'].includes(path);}
function preserveTestRunInAdminLinks(runId){
  for(const link of document.querySelectorAll('a[href]')){
    if(link.closest('#syntheticRunBanner'))continue;
    try{
      const target=new URL(link.getAttribute('href'),location.href);
      if(target.origin!==location.origin||!/^\/(admin|owner)\//.test(target.pathname))continue;
      target.searchParams.set('testRunId',runId);link.href=target.pathname+target.search+target.hash;
    }catch(_){}
  }
}
function showTestRunBanner(){
  const runId=new URLSearchParams(location.search).get('testRunId');
  if(!runId||!document.querySelector('.admin-main')||document.getElementById('syntheticRunBanner'))return;
  if(!document.getElementById('syntheticRunBannerStyle')){const style=document.createElement('style');style.id='syntheticRunBannerStyle';style.textContent='.synthetic-run-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 14px;padding:13px 16px;border:1px solid #a66f12;border-radius:12px;background:linear-gradient(110deg,#3b2c11,#1d1a12);color:#ffe4a3;font-size:12px;line-height:1.5}.synthetic-run-banner>div{display:grid;gap:2px}.synthetic-run-banner strong{font-size:10px;letter-spacing:.12em}.synthetic-run-banner a{flex:0 0 auto;color:#ffe4a3;font-weight:850;text-decoration:underline}.synthetic-test-chip{display:inline-flex;align-items:center;margin-left:6px;padding:2px 5px;border:1px solid #8d641c;border-radius:999px;background:#35280f;color:#ffdf8c;font-size:8px;font-weight:900;letter-spacing:.08em;vertical-align:middle}@media(max-width:640px){.synthetic-run-banner{align-items:flex-start;flex-direction:column}}';document.head.append(style);}
  const banner=document.createElement('div');banner.id='syntheticRunBanner';banner.className='synthetic-run-banner';banner.setAttribute('role','status');
  const message=document.createElement('div');message.innerHTML='<strong>TEST GÖRÜNÜMÜ</strong><span>Bu çalıştırmadaki işlemler, kullanıcılar ve tutarlar sentetiktir. Gerçek üye bakiyesi, kasa, ekip teminatı ve zincir transferi değildir.</span>';
  const url=new URL(location.href);url.searchParams.delete('testRunId');
  const normal=document.createElement('a');normal.href=url.pathname+url.search+url.hash;normal.textContent='Normal görünüme dön';
  banner.append(message,normal);const main=document.querySelector('.admin-main');main.insertBefore(banner,main.firstChild);preserveTestRunInAdminLinks(runId);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',showTestRunBanner,{once:true});else showTestRunBanner();
async function adminFetch(path,opts={}){
  opts.credentials='include';opts.headers={...(opts.headers||{}),'Content-Type':'application/json'};
  const ownerPortal=location.pathname.includes('/owner/'),runId=new URLSearchParams(location.search).get('testRunId'),base=String(path).split('?')[0];
  if(runId&&testRunApiPath(base)){
    const query=new URLSearchParams(String(path).includes('?')?String(path).split('?').slice(1).join('?'):'');
    query.set('testRunId',runId);path=base+'?'+query.toString();
  }
  const r=await fetch(activeAdminApi()+path,opts),d=await r.json();
  if(r.status===401){location.href=ownerPortal?'/owner/login.html?denied=1':'/admin/login.html?denied=1';throw new Error('unauthorized');}
  if(r.status===403)throw new Error(d.message||(ownerPortal?'Owner paneline erişim reddedildi.':'Ekip paneline erişim reddedildi.'));
  if(!r.ok)throw new Error(d.message||d.error||'request_failed');
  return d;
}
async function adminLogin(email,password,code){const r=await fetch(ADMIN_API+'/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,code})});const d=await r.json();if(!r.ok)throw new Error(d.error||'invalid');return d;}
async function ownerLogin(email,password,code){const r=await fetch(OWNER_API+'/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,code})});const d=await r.json();if(!r.ok)throw new Error(d.error||'invalid');return d;}
async function adminLogout(){const owner=location.pathname.includes('/owner/');try{await fetch((owner?OWNER_API:ADMIN_API)+'/logout',{method:'POST',credentials:'include'});}catch(_){}if(window.SafeAdmin?.clearSessionProfile)SafeAdmin.clearSessionProfile();localStorage.removeItem('safepays_portal');location.replace(owner?'/owner/login.html':'/admin/login.html');}
async function getMaintenanceSettings(){return await adminFetch('/maintenance');}
async function saveMaintenanceSettings(payload){return await adminFetch('/maintenance',{method:'POST',body:JSON.stringify(payload)});}
async function findUserByEmail(email){const users=await getUsers();return users.find(u=>u.email.toLowerCase()===email.toLowerCase());}
async function findUserByPhone(phone){return await (await getUsers()).find(u=>normalizePhone(u.phone)===phone);}
async function findUserById(id){return await (await getUsers()).find(u=>u.id===id);}
