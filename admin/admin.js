// Admin UI is intentionally dark-only. Lock this before the page body renders.
if(location.pathname.includes('/admin/')){document.documentElement.classList.add('admin-portal','dark-theme');try{localStorage.setItem('safepays-admin-theme','dark');}catch(_){}}
else if(location.pathname.includes('/owner/'))document.documentElement.classList.add('owner-portal');

function formatTime(s){let m=Math.floor(s/60),sec=s%60;return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')}
function tick(){document.querySelectorAll('.timer').forEach(el=>{let s=parseInt(el.dataset.seconds||'0');if(s>0)s--;el.dataset.seconds=s;el.textContent=s?formatTime(s):'Otomatik reddediliyor';el.classList.remove('timer-green','timer-yellow','timer-red');if(s>600)el.classList.add('timer-green');else if(s>300)el.classList.add('timer-yellow');else if(s>0)el.classList.add('timer-red');else{el.classList.add('timer-red');if(el.dataset.autored==='1'){el.textContent='Otomatik reddedildi'}}})}
setInterval(tick,1000)

// Apply consistent semantic colors to financial values in every staff table.
// Header mapping covers report tables; transaction rows also use their type or
// ledger direction when the amount column itself is generically labeled.
(function installFinancialAmountColors(){
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('tr-TR');
  function category(label){
    const text=normalize(label);
    if(/komisyon|commission|bonus|prim/.test(text))return 'amount-commission';
    if(/yatirim|deposit|gelen tutar|alinan yatirim/.test(text))return 'amount-deposit';
    if(/cekim|withdraw|odenen tutar/.test(text))return 'amount-withdrawal';
    if(/kasa|bakiye|balance|mevcut tutar/.test(text))return 'amount-cash';
    return '';
  }
  function mark(cell,className){if(className&&!cell.classList.contains(className))cell.classList.add(className);}
  function scan(root=document){
    const tables=new Set(root.matches?.('table')?[root]:[]);
    const parentTable=root.closest?.('table');if(parentTable)tables.add(parentTable);
    root.querySelectorAll('table').forEach(table=>tables.add(table));
    tables.forEach(table=>{
      const headers=[...table.querySelectorAll('thead tr:last-child th')];
      if(!headers.length)return;
      const kinds=headers.map(header=>category(header.textContent));
      const amountIndexes=headers.map((header,index)=>/tutar|miktar|amount|usdt/i.test(normalize(header.textContent))?index:-1).filter(index=>index>=0);
      const typeIndex=headers.findIndex(header=>/tur|islem|direction|yon/.test(normalize(header.textContent)));
      table.querySelectorAll('tbody tr').forEach(row=>{
        const cells=[...row.cells];
        kinds.forEach((kind,index)=>{if(kind&&cells[index])mark(cells[index],kind);});
        if(typeIndex<0||!cells[typeIndex])return;
        const type=normalize(cells[typeIndex].textContent);
        const rowKind=/yatirim|deposit|credit|giris/.test(type)?'amount-deposit':/cekim|withdraw|debit|cikis/.test(type)?'amount-withdrawal':'';
        if(rowKind)amountIndexes.forEach(index=>{if(cells[index])mark(cells[index],rowKind);});
      });
    });
  }
  function start(){scan();new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches('table'))scan(node.parentElement||document);else scan(node);}}}).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

function filterTable(){let q=(document.getElementById('search')?.value||'').toLowerCase();document.querySelectorAll('#requests tr').forEach((r,i)=>{if(i===0)return;r.style.display=r.innerText.toLowerCase().includes(q)?'':'none'})}
document.addEventListener('DOMContentLoaded',()=>{
  const a=window.SafeAdmin?.current?.();
  if(!a) return;
  const head=document.querySelector('.admin-head') || document.querySelector('.team-head');
  if(!head) return;
  const isOwner=a.role==='Super Admin';
  const name=isOwner?'Super Admin':(a.teamName||a.name||a.email||'Ekip');

  // Keep one shared profile control set on every staff page.
  // The standalone team-name chip was removed: the team name is shown only
  // inside the profile dropdown so the header stays compact and consistent.
  const legacyUser=head.querySelector('.admin-user');
  if(legacyUser && legacyUser.id!=='adminCurrentUser') legacyUser.remove();

  let box=document.getElementById('adminToolsShared');
  if(!box){
    box=document.createElement('div');
    box.className='admin-tools';
    box.id='adminToolsShared';
    box.innerHTML='<a class="admin-user-link team-profile-chip" href="profile.html" id="adminCurrentUser"><span class="team-profile-avatar" aria-hidden="true">◉</span><span class="team-profile-name">Profilim</span></a>';
    const host = head.classList.contains('team-head') ? (head.querySelector('.team-head > div:last-child') || head) : head;
    const dateCard = host.querySelector('.date-card');
    if(dateCard) host.insertBefore(box,dateCard); else host.appendChild(box);
  }

  // Standalone team-name chip intentionally removed. Team name remains in the profile dropdown.
  const u=document.getElementById('adminCurrentUser');
  if(u){
    u.href=isOwner?'../owner/profile.html':'profile.html';
    u.innerHTML='<span class="team-profile-avatar" aria-hidden="true">'+String(name).trim().charAt(0).toUpperCase()+'</span><span class="team-profile-name">'+name+' · Profilim</span><span class="team-profile-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 9 5 5 5-5"/></svg></span>';
    if(!u.dataset.dropdownReady){
      u.dataset.dropdownReady='1';
      u.setAttribute('aria-haspopup','menu');
      u.setAttribute('aria-expanded','false');
      const menu=document.createElement('div');
      menu.className='team-profile-menu';
      menu.innerHTML=''+
        '<a href="profile.html" class="team-menu-item"><span class="team-menu-icon">⌾</span><span>Profilim</span></a>'+
        '<div class="team-menu-divider"></div>'+
        '<button type="button" class="team-menu-item team-menu-logout"><span class="team-menu-icon">↪</span><span>Çıkış Yap</span></button>';
      u.parentElement.style.position='relative';
      u.parentElement.appendChild(menu);
      const close=()=>{menu.classList.remove('open');u.setAttribute('aria-expanded','false')};
      u.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const open=menu.classList.toggle('open');u.setAttribute('aria-expanded',open?'true':'false')});
      menu.addEventListener('click',e=>e.stopPropagation());
      document.addEventListener('click',close);
      menu.querySelector('.team-menu-logout').addEventListener('click',async()=>{
        const ownerPortal=location.pathname.includes('/owner/');
        try{await fetch(ownerPortal?'../api/owner/logout':'../api/admin/logout',{method:'POST',credentials:'include'});}catch(_){}
        if(window.SafeAdmin?.clearSessionProfile)SafeAdmin.clearSessionProfile();
        localStorage.removeItem('safepays_portal');
        location.href=ownerPortal?'../owner/login.html':'login.html';
      });
    }
  }

  // Team dashboard previously had its own profile block; the shared controls replace it.
  const legacy=head.querySelector('.team-profile');
  if(legacy) legacy.remove();
});
/* Separate portal guard and navigation for Team Admin and Owner pages. */
(function(){
  function current(){try{return window.SafeAdmin?.current?.()||null}catch(e){return null}}
  const ownerPortal=location.pathname.includes('/owner/');
  async function verifyPortalSession(){
    try{
      const r=await fetch(ownerPortal?'../api/owner/me':'../api/admin/me',{credentials:'include',cache:'no-store'});
      if(!r.ok) return false;
      const d=await r.json();
      const identity=ownerPortal?d.owner:d.admin;
      if(ownerPortal?identity?.role!=='owner':identity?.role!=='team_admin')return false;
      if(window.SafeAdmin?.setSessionProfile)SafeAdmin.setSessionProfile({...identity,id:identity.id,email:identity.email,role:ownerPortal?'Super Admin':'Team Admin',name:ownerPortal?'Super Admin':'Admin Ekibi',permissions:identity.permissions});
      return true;
    }catch(e){ return false; }
  }
  async function guard(){
    const path=location.pathname.split('/').pop()||'dashboard.html';
    if(path==='login.html')return true;
    const serverOk=await verifyPortalSession();
    if(!serverOk){
      localStorage.removeItem('safepays_portal');
      if(window.SafeAdmin?.clearSessionProfile)SafeAdmin.clearSessionProfile();
      location.replace('login.html?denied=1');return false;
    }
    return true;
  }
  async function setupNav(){
    if(!(await guard())) return;
    const a=current();
    const icon=(name)=>{const paths={
      home:'<path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 10v10h13V10"/><path d="M9.5 20v-6h5v6"/>',
      clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
      check:'<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12 2.4 2.4 5-5"/>',
      x:'<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
      handshake:'<path d="m4 10 3-3 4 3 4-3 3 3"/><path d="M4 10v6l4 3 4-3 4 3 3-3v-6"/><path d="m8 10 4 3 4-3"/>',
      chart:'<path d="M4 19V9M10 19V5M16 19v-7M21 19H3"/>',
      users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.3 2.5-5 5.5-5s4.9 1.7 5.5 5"/><path d="M15 6.5a3 3 0 0 1 0 5.8M16 14c2.1.4 3.4 2 4 5"/>',
      wallet:'<path d="M4 6.5h13.5A2.5 2.5 0 0 1 20 9v8.5A2.5 2.5 0 0 1 17.5 20H5a2 2 0 0 1-2-2V7.5A1.5 1.5 0 0 1 4.5 6H18"/><path d="M15 12h5v4h-5a2 2 0 1 1 0-4Z"/>',
      coins:'<circle cx="9" cy="9" r="5.5"/><path d="M9 6.5v5M7 8.5c0-1 4-1 4 0s-4 1-4 2 4 1 4 2"/><path d="M14 14a5.5 5.5 0 0 0 4.5 1.5M15 17a5.5 5.5 0 0 0 2.5 2"/>',
      news:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 11h8M8 14h5"/>',
      team:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.4-4.5 5.5-4.5s5 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.2"/><path d="M15 14c2.6.2 4.2 1.7 4.7 4"/>',
      shield:'<path d="M12 3 19 6v5c0 4.5-2.8 7.4-7 10-4.2-2.6-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
      user:'<circle cx="12" cy="8" r="3.2"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.6V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.6-1H6v-2.6h.4A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2.6V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V14h-.2a1.7 1.7 0 0 0-1.6 1Z"/>',
      lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      back:'<path d="M10 6 4 12l6 6"/><path d="M4 12h16"/>'
    };return `<span class="nav-icon nav-icon-${name}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg></span>`};
    const staffItems=[
      ['team-dashboard.html','home','Genel Bakış'],['requests.html','clock','Bekleyen İşlemler'],['requests.html?type=withdrawal','wallet','Çekim Havuzu'],['history.html?status=approved','check','Onaylanan İşlemler'],['history.html?status=rejected','x','Reddedilen İşlemler'],['reconciliation.html','handshake','Mutabakat'],['reports.html','chart','Raporlar'],['wallet-addresses.html','wallet','Cüzdan Hesapları'],['support.html','news','Destek Talepleri'],['profile.html','user','Profilim']
    ];
    const ownerItems=[
      ['member-operations.html','user','Kullanıcılar'],
      ['dashboard.html','home','Genel Bakış'],['requests.html','clock','Bekleyen İşlemler'],['withdrawal-pool.html','clock','Çekim Talepleri'],['history.html?status=approved','check','Onaylanan İşlemler'],['history.html?status=rejected','x','Reddedilen İşlemler'],['reconciliation.html','handshake','Mutabakat'],['reports.html','chart','Raporlar'],['wallet-addresses.html','wallet','Cüzdan Hesapları'],['support.html','news','Destek Talepleri'],['content.html','news','Site İçeriği'],['audit.html','shield','Audit Logları'],['settings.html','settings','Ayarlar'],['profile.html','user','Profilim'],['../index.html','back','Siteye Dön']
    ];
    const isOwner=ownerPortal&&a?.role==='Super Admin';
    localStorage.setItem('safepays_portal',isOwner?'owner':'admin');
    const items=isOwner?ownerItems:staffItems.filter(([href])=>{
      const file=href.split('?')[0];
      if(['requests.html','withdrawal-pool.html','history.html'].includes(file))return a?.permissions?.transactions!==false;
      if(['reconciliation.html','reports.html'].includes(file))return a?.permissions?.reports!==false;
      if(file==='wallet-addresses.html')return a?.permissions?.wallets!==false;
      if(file==='support.html')return a?.permissions?.support!==false;
      return true;
    });
    if(!ownerPortal) document.querySelectorAll('.admin-nav').forEach(nav=>{
      nav.replaceChildren(...items.map(([href,ico,label])=>{const el=document.createElement('a');el.href=href;el.innerHTML=icon(ico)+'<span>'+label+'</span>';return el;}));
      const path=location.pathname.split('/').pop()||'dashboard.html';
      nav.querySelectorAll('a').forEach(el=>{const u=new URL(el.href,location.href),wantedParams=new URLSearchParams(u.search),currentParams=new URLSearchParams(location.search);const samePath=u.pathname.split('/').pop()===path;const wantedStatus=wantedParams.get('status');const currentStatus=currentParams.get('status');const sameStatus=(wantedStatus===null&&currentStatus===null)||(wantedStatus!==null&&wantedStatus===currentStatus);const wantedType=wantedParams.get('type');const currentType=currentParams.get('type');const sameType=(wantedType===null&&currentType===null)||(wantedType!==null&&wantedType===currentType);el.classList.toggle('active',samePath&&sameStatus&&sameType)});
    });
    const side=document.querySelector('.admin-side');
    if(side && !document.getElementById('adminMenuToggle')){
      const b=document.createElement('button');b.id='adminMenuToggle';b.className='admin-menu-toggle';b.setAttribute('aria-label','Menüyü aç/kapat');b.innerHTML='☰';document.body.appendChild(b);
      b.onclick=()=>{side.classList.toggle('open');document.body.classList.toggle('admin-nav-open')};
      document.addEventListener('click',e=>{if(document.body.classList.contains('admin-nav-open')&&!side.contains(e.target)&&e.target!==b){side.classList.remove('open');document.body.classList.remove('admin-nav-open')}});
    }
    if(location.search.includes('access=denied')){
      const note=document.createElement('div');note.className='owner-access-note';note.textContent='Bu bölüm yalnızca Site Sahibi hesabına açıktır.';document.body.appendChild(note);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupNav);else setupNav();
})();
