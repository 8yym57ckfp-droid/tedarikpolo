const ADMIN_API='/api/admin';
const OWNER_API='/api/owner';
const SYNTHETIC_RUN_STORAGE_KEY='safepaysActiveSyntheticFinanceRunId';
function adminToken(){return '';}
function activeAdminApi(){return location.pathname.includes('/owner/')?OWNER_API:ADMIN_API;}
function restoreSyntheticRunContext(){
  const params=new URLSearchParams(location.search),runId=params.get('testRunId');
  try{
    if(runId){localStorage.setItem(SYNTHETIC_RUN_STORAGE_KEY,runId);return;}
    const page=location.pathname.match(/^\/(admin|owner)\/(team-dashboard|dashboard|requests|withdrawal-pool|history|reconciliation|reports|wallet-addresses)\.html$/);
    if(!page)return;
    const remembered=localStorage.getItem(SYNTHETIC_RUN_STORAGE_KEY);
    if(!remembered)return;
    params.set('testRunId',remembered);
    const next=new URL(location.href);next.search=params.toString();location.replace(next.pathname+next.search+next.hash);
  }catch(_){}
}
restoreSyntheticRunContext();
function clearInvalidSyntheticRun(){
  try{
    localStorage.removeItem(SYNTHETIC_RUN_STORAGE_KEY);
    const url=new URL(location.href);url.searchParams.delete('testRunId');
    location.replace(url.pathname+url.search+url.hash);
  }catch(_){}
}
function testRunApiPath(path,method='GET'){return ['/stats','/users','/user-center','/transactions','/transactions/decision','/transactions/lock','/transactions/reopen','/ledger','/finance/reconciliation'].includes(path)||(path==='/wallet-addresses'&&String(method).toUpperCase()==='GET');}
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
  const main=document.querySelector('.admin-main');
  if(!runId||!main||document.getElementById('syntheticRunBanner'))return;
  if(!document.getElementById('syntheticRunBannerStyle')){const style=document.createElement('style');style.id='syntheticRunBannerStyle';style.textContent='.synthetic-run-banner{display:inline-flex;align-items:center;gap:8px;margin-left:10px;padding:4px 8px;border:1px solid #8d641c;border-radius:999px;background:#35280f;color:#ffdf8c;font-size:9px;line-height:1.3;vertical-align:middle}.synthetic-run-banner strong{font-size:9px;letter-spacing:.06em}.synthetic-run-banner a{color:#ffe4a3;font-weight:800;text-decoration:underline}.synthetic-test-chip{display:inline-flex;align-items:center;margin-left:6px;padding:2px 5px;border:1px solid #8d641c;border-radius:999px;background:#35280f;color:#ffdf8c;font-size:8px;font-weight:900;letter-spacing:.08em;vertical-align:middle}';document.head.append(style);}
  const banner=document.createElement('span');banner.id='syntheticRunBanner';banner.className='synthetic-run-banner';banner.setAttribute('role','status');
  const message=document.createElement('strong');message.textContent='TEST VERİSİ';message.title='Bu çalıştırmadaki işlemler ve tutarlar sentetiktir; gerçek bakiye veya zincir transferi değildir.';
  const url=new URL(location.href);url.searchParams.delete('testRunId');
  const normal=document.createElement('a');normal.href=url.pathname+url.search+url.hash;normal.textContent='Normal görünüme dön';
  normal.addEventListener('click',()=>{try{localStorage.removeItem(SYNTHETIC_RUN_STORAGE_KEY);}catch(_){}});
  banner.append(message,normal);const title=main.querySelector('.admin-head h1');if(title)title.append(banner);else main.insertBefore(banner,main.firstChild);preserveTestRunInAdminLinks(runId);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',showTestRunBanner,{once:true});else showTestRunBanner();
async function adminFetch(path,opts={}){
  opts.credentials='include';opts.headers={...(opts.headers||{}),'Content-Type':'application/json'};
  const ownerPortal=location.pathname.includes('/owner/'),runId=new URLSearchParams(location.search).get('testRunId'),base=String(path).split('?')[0];
  if(runId&&testRunApiPath(base,opts.method||'GET')){
    const query=new URLSearchParams(String(path).includes('?')?String(path).split('?').slice(1).join('?'):'');
    query.set('testRunId',runId);path=base+'?'+query.toString();
  }
  const r=await fetch(activeAdminApi()+path,opts),d=await r.json();
  if(r.status===401){location.href=ownerPortal?'/owner/login.html?denied=1':'/admin/login.html?denied=1';throw new Error('unauthorized');}
  if(d.error==='synthetic_run_not_found'||d.error==='test_run_team_scope_denied'){clearInvalidSyntheticRun();throw new Error(d.error);}
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
