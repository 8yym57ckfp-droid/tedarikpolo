(function(){
  // Owner navigation SVG icon set. Keep this local to the Owner panel so generic
  // admin navigation code/CSS cannot remove or override the icons.
  const icons={
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5h5v5"/>',
    clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    wallet:'<path d="M4 7.5h14.5A1.5 1.5 0 0 1 20 9v9.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-11Z"/><path d="M4 7.5V6a2 2 0 0 1 2-2h11"/><path d="M15.5 14h.01"/>',
    check:'<circle cx="12" cy="12" r="8.5"/><path d="m8 12 2.5 2.5L16 9"/>',
    x:'<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6"/>',
    handshake:'<path d="m4 11 4-4 4 3 3-3 5 4-3 3 1 1-4 4-3-3-2 2-5-5 2-2-2-2Z"/>',
    chart:'<path d="M5 19V9m7 10V5m7 14v-7"/>',
    team:'<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20c.5-3.4 2.3-5 5.5-5s5 1.6 5.5 5"/><path d="M14 15.5c2.7-.2 4.7 1.2 5.2 4.5"/>',
    coins:'<circle cx="9" cy="9" r="5"/><path d="M9 6.5v5m-2 0h4"/><path d="M14 7.5a5 5 0 0 1 4.5 7.2"/><path d="M14 14.5a5 5 0 0 1-7.2 4.5"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3.5 2.3-5 5.5-5s5 1.5 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.5"/><path d="M16 14c2.5.3 4 1.8 4.5 5"/>',
    news:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.9-1.1L14.3 3h-4.1l-.3 2.9a7 7 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5.5 12c0 .4 0 .7.1 1.1l-2 1.5 2 3.4 2.4-1c.6.5 1.2.9 1.9 1.1l.3 2.9h4.1l.3-2.9c.7-.2 1.3-.6 1.9-1.1l2.4 1 2-3.4-2-1.5c.1-.4.1-.7.1-1.1Z"/>',
    shield:'<path d="M12 3 19 6v5c0 4.5-2.8 7.7-7 10-4.2-2.3-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
    user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4.1 3-6 7-6s6.3 1.9 7 6"/>',
    back:'<path d="M19 12H5m6-6-6 6 6 6"/>'
  };
  function me(){ try{return window.SafeAdmin?.current?.()||null}catch(e){return null} }
  async function guard(){
    const local=me();
    try{
      const r=await fetch('../api/owner/me',{credentials:'include',cache:'no-store'});
      if(!r.ok) throw new Error('unauthorized');
      const d=await r.json();
      const owner=d.owner||{};
      if(owner.role!=='owner') throw new Error('forbidden');
      if(window.SafeAdmin?.setSessionProfile) SafeAdmin.setSessionProfile({id:owner.id,email:owner.email,role:'Super Admin',name:'Super Admin'});
      return true;
    }catch(e){
      if(location.pathname.endsWith('/login.html') || location.pathname.endsWith('login.html')) return false;
      localStorage.removeItem('safepays_portal');
      if(window.SafeAdmin?.clearSessionProfile) SafeAdmin.clearSessionProfile();
      location.replace('login.html?denied=1');
      return false;
    }
  }
  function nav(){
    const el=document.querySelector('.admin-nav'); if(!el)return;
    const brand=document.querySelector('.admin-side .logo');
    if(brand){brand.href='dashboard.html';brand.innerHTML='<span class="owner-brand-wordmark">Safe<span>Pays</span></span><small>OWNER PANEL</small>';}
    const items=[
      ['GENEL',[['dashboard.html','home','Genel Bakış']]],
      ['İŞLEMLER',[['requests.html','clock','Beklenen İşlemler'],['withdrawal-pool.html','wallet','Çekim Havuzu'],['history.html?status=approved','check','Onaylanan İşlemler'],['history.html?status=rejected','x','Reddedilen İşlemler'],['reconciliation.html','handshake','Mutabakat'],['reports.html','chart','Raporlar']]],
      ['FİNANS',[['wallet-addresses.html','wallet','Cüzdan Hesapları'],['team-accounts.html','team','Ekip Hesapları'],['earnings.html','coins','Kazanç & Bonuslar'],['test-data.html','chart','Finans Test Verisi']]],
      ['KULLANICILAR',[['member-operations.html','users','Üye Operasyonları'],['support.html','news','Destek Talepleri']]],
      ['İÇERİK',[['content.html','news','İçerik Merkezi']]],
      ['SİSTEM',[['panel-site-management.html','settings','Panel & Site Yönetimi'],['audit.html','shield','İşlem / Audit Logları'],['settings.html','settings','Ayarlar'],['profile.html','user','Profilim'],['../index.html','back','Siteye Dön']]]
    ];
    el.innerHTML='';
    for(const [title,links] of items){
      const h=document.createElement('div');h.className='owner-nav-title';h.textContent=title;el.appendChild(h);
      for(const [href,icon,label] of links){
        const a=document.createElement('a');a.href=href;
        const linkedPage=new URL(a.href,location.href).pathname.split('/').pop();
        if(currentParams.has('testRunId')&&['dashboard.html','requests.html','withdrawal-pool.html','history.html','reconciliation.html','reports.html'].includes(linkedPage)){
          const targetUrl=new URL(a.href,location.href);targetUrl.searchParams.set('testRunId',currentParams.get('testRunId'));a.href=targetUrl.href;
        }
        a.innerHTML=`<span class="owner-nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[icon]||''}</svg></span><span>${label}</span>`;el.appendChild(a);
      }
    }
    const currentPath=location.pathname.split('/').pop()||'dashboard.html';
    const currentParams=new URLSearchParams(location.search);
    el.querySelectorAll('a').forEach(a=>{
      const u=new URL(a.href,location.href);
      const samePath=u.pathname.split('/').pop()===currentPath;
      let active=samePath;
      // history.html has two different owner menu entries but shares the same path.
      // Only the entry matching the current status query may be highlighted.
      if(samePath && currentPath==='history.html'){
        const targetStatus=u.searchParams.get('status')||'';
        const activeStatus=currentParams.get('status')||'';
        active=targetStatus===activeStatus;
      }
      a.classList.toggle('active',active);
    });
  }
  async function setup(){
    if(!(await guard()))return;
    document.body.classList.add('owner-page');
    nav();
    const side=document.querySelector('.admin-side');
    if(side&&!document.getElementById('ownerMenuToggle')){
      const b=document.createElement('button');b.id='ownerMenuToggle';b.className='admin-menu-toggle';b.textContent='☰';document.body.appendChild(b);
      b.onclick=()=>{side.classList.toggle('open');document.body.classList.toggle('admin-nav-open')};
      document.addEventListener('click',e=>{if(document.body.classList.contains('admin-nav-open')&&!side.contains(e.target)&&e.target!==b){side.classList.remove('open');document.body.classList.remove('admin-nav-open')}});
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
  window.OwnerGuard={guard};
})();
