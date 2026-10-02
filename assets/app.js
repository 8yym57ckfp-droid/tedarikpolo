
(function(){
  // Theme is isolated by portal so Admin/Owner theme changes never affect
  // member pages opened in another tab on the same origin.
  function themeScope(){
    const p=location.pathname||'';
    if(p.includes('/admin/')) return 'admin';
    if(p.includes('/owner/')) return 'owner';
    return 'member';
  }
  const key='safepays-'+themeScope()+'-theme';
  const defaults={member:'dark',admin:'light',owner:'dark'};
  let saved=defaults[themeScope()]||'dark';
  try{ saved=localStorage.getItem(key)||saved; }catch(e){}
  if(saved==='dark') document.documentElement.classList.add('dark-theme');
  function syncTheme(){
    const dark=document.documentElement.classList.contains('dark-theme');
    document.body.classList.toggle('dark-theme',dark);
    const sw=document.getElementById('themeSwitch');
    const adminSw=document.getElementById('adminThemeSwitch');
    [sw,adminSw].forEach(el=>{
      if(el){el.classList.toggle('is-dark',dark);el.setAttribute('aria-pressed',String(dark));}
    });
  }
  window.toggleTheme=function(){
    const dark=!document.documentElement.classList.contains('dark-theme');
    document.documentElement.classList.toggle('dark-theme',dark);
    try{ localStorage.setItem(key,dark?'dark':'light'); }catch(e){}
    syncTheme();
  };
  document.addEventListener('DOMContentLoaded',function(){
    syncTheme();
    const sw=document.getElementById('themeSwitch');
    if(!sw)return;
    sw.addEventListener('click',window.toggleTheme);
    let down=false,startX=0,startDark=false,moved=false;
    sw.addEventListener('pointerdown',e=>{down=true;startX=e.clientX;startDark=document.documentElement.classList.contains('dark-theme');moved=false;sw.setPointerCapture?.(e.pointerId);});
    sw.addEventListener('pointermove',e=>{if(!down)return;if(Math.abs(e.clientX-startX)>7)moved=true;});
    sw.addEventListener('pointerup',e=>{
      if(!down)return;down=false;
      if(moved){
        const delta=e.clientX-startX;
        const shouldDark=delta>8 ? true : delta<-8 ? false : startDark;
        if(shouldDark!==document.documentElement.classList.contains('dark-theme')) window.toggleTheme();
      }
    });
  });
})();

function spModalTheme(title,message,kind){
  const t=(String(title||'')+' '+String(message||'')).toLocaleLowerCase('tr-TR');
  if(/çekim.*(dondur|engellen|blok)|withdrawal.*(freeze|block)/.test(t)) return 'withdrawal-frozen';
  if(/yatırım.*(dondur|engellen|blok)|deposit.*(freeze|block)/.test(t)) return 'deposit-frozen';
  if(/hesap.*(kilit|lock)|account.*lock/.test(t)) return 'locked';
  if(/askıya|suspend/.test(t)) return 'suspended';
  if(/güvenlik.*incele|security.*review/.test(t)) return 'security';
  if(/redded|başarısız|failed|uygun bulunmad/.test(t)) return 'rejected';
  if(/başarılı|başarıyla|tamamlandı|onaylandı|success/.test(t)) return 'success';
  if(/çekim.*işlemi|çekim taleb/.test(t)) return 'withdrawal';
  if(/yatırım.*işlemi|yatırım taleb/.test(t)) return 'deposit';
  return kind==='error'?'rejected':'info';
}

function spModalIcon(theme){
  const icons={
    'withdrawal-frozen':'<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path><path d="m9 16 6 0"></path>',
    'deposit-frozen':'<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path><path d="M12 14v4"></path><path d="m10.5 16 1.5 2 1.5-2"></path>',
    locked:'<circle cx="12" cy="12" r="9"></circle><path d="m8 8 8 8"></path><path d="m16 8-8 8"></path>',
    suspended:'<rect x="6" y="5" width="12" height="14" rx="2"></rect><path d="M10 9v6M14 9v6"></path>',
    security:'<path d="M12 3.5 21 20H3z"></path><path d="M12 9v5"></path><circle cx="12" cy="17.5" r=".8"></circle>',
    rejected:'<path d="M7 7 17 17M17 7 7 17"></path><circle cx="12" cy="12" r="9"></circle>',
    success:'<path d="m7 12 3 3 7-8"></path><circle cx="12" cy="12" r="9"></circle>',
    withdrawal:'<path d="M5 12h13"></path><path d="m13 7 5 5-5 5"></path>',
    deposit:'<path d="M12 5v13"></path><path d="m7 13 5 5 5-5"></path>',
    info:'<circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><circle cx="12" cy="7" r=".8"></circle>'
  };
  return icons[theme]||icons.info;
}

function showAppModal(title,message,kind='error'){
  let modal=document.getElementById('spAppModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='spAppModal';
    modal.className='sp-modal-backdrop';
    modal.innerHTML=`<div class="sp-modal" role="dialog" aria-modal="true" aria-labelledby="spModalTitle">
      <button class="sp-modal-close" type="button" aria-label="Kapat" onclick="closeAppModal()">×</button>
      <div class="sp-modal-icon"><svg viewBox="0 0 24 24" aria-hidden="true"></svg></div>
      <div class="sp-modal-kicker">SAFEPAYS</div>
      <h3 id="spModalTitle"></h3>
      <p id="spModalMessage"></p>
      <button class="sp-modal-action" type="button" onclick="closeAppModal()">Tamam</button>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal)closeAppModal()});
  }
  const theme=spModalTheme(title,message,kind);
  const titleMap={
    'withdrawal-frozen':'Çekimler Donduruldu','deposit-frozen':'Yatırımlar Donduruldu',locked:'Hesap Kilitli',
    suspended:'Hesap Askıya Alındı',security:'Güvenlik İncelemesi',rejected:'İşlem Reddedildi',success:'İşlem Başarılı',
    withdrawal:'Çekim İşlemi',deposit:'Yatırım İşlemi',info:'Safepays Bilgilendirmesi'
  };
  const themeTitle=titleMap[theme];
  const icon=modal.querySelector('.sp-modal-icon');
  modal.querySelector('#spModalTitle').textContent=themeTitle||title;
  modal.querySelector('#spModalMessage').textContent=message;
  icon.className='sp-modal-icon '+theme;
  icon.querySelector('svg').innerHTML=spModalIcon(theme);
  modal.querySelector('.sp-modal-action').className='sp-modal-action '+theme;
  modal.classList.add('open');
  document.body.classList.add('sp-modal-open');
  setTimeout(()=>modal.querySelector('.sp-modal-action')?.focus(),30);
}
function closeAppModal(){const m=document.getElementById('spAppModal');if(m){m.classList.remove('open');document.body.classList.remove('sp-modal-open')}}
function showErrorModal(title,message){showAppModal(title,message,'error')}
function toast(msg){
  const text=String(msg??'').trim();
  if(!text)return;
  const lower=text.toLocaleLowerCase('tr-TR');
  const isError=/hata|geçerli|zorunlu|başarısız|bulunamadı|yetersiz|doldu|uyumsuz|kullanılmış|kaydedilemedi|gerekir|donduruldu|kilitlendi|askıya/.test(lower);
  showAppModal('',text,isError?'error':'info');
}

// Safepays'teki kullanıcı uyarıları tarayıcının native alert penceresi yerine
// ortak marka modalını kullanır. Böylece tüm sayfalarda aynı deneyim korunur.
window.alert=function(message){toast(message)};
function normalizeSafepaysUser(u){
  if(!u||typeof u!=='object')return null;
  let first=String(u.firstName||u.first_name||'').trim();
  let last=String(u.lastName||u.last_name||'').trim();
  const full=String(u.fullName||u.full_name||u.displayName||u.name||'').trim();
  if((!first||!last)&&full){
    const parts=full.split(/\s+/).filter(Boolean);
    if(!first)first=parts.shift()||'';
    if(!last)last=parts.join(' ');
  }
  return {...u,firstName:first,lastName:last};
}
function syncSafepaysHeaderUser(){
  try{
    const raw=getSafepaysCurrentUser();
    const u=normalizeSafepaysUser(raw);
    if(!u)return;
    const first=String(u.firstName||'').trim(), last=String(u.lastName||'').trim();
    const initials=((first[0]||'')+(last[0]||'')).toUpperCase()||'SP';
    document.querySelectorAll('.avatar-sm').forEach(el=>el.textContent=initials);
    const paintBalance=(val)=>{
      document.querySelectorAll('.wallet-balance-pill').forEach(el=>{
        const value=el.querySelector('span:last-child b');
        if(value)value.innerHTML=Number.isFinite(val)?val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' <em>USDT</em>':'— <em>USDT</em>';
      });
    };
    paintBalance(null);
    document.querySelectorAll('.wallet-balance-pill small').forEach(el=>el.textContent='Cüzdan Bakiyesi');
    // Refresh the displayed balance from the authenticated server session.
    const token=localStorage.getItem('safepays_api_token');
    if(token){
      fetch('/api/auth/me',{headers:{Authorization:'Bearer '+token}})
        .then(r=>r.ok?r.json():null)
        .then(d=>{ if(d && d.user && Number.isFinite(Number(d.user.balance))) paintBalance(Number(d.user.balance)); else paintBalance(null); })
        .catch(()=>paintBalance(null));
    }
  }catch(e){console.warn('Safepays header kullanıcı senkronizasyonu başarısız',e)}
}

document.addEventListener('DOMContentLoaded', syncSafepaysHeaderUser);

function getSafepaysCurrentUser(){
  try{
    const raw=localStorage.getItem('safepays_current_user');
    if(raw){const u=JSON.parse(raw); if(u && (u.email||u.firstName||u.lastName)) return u;}
  }catch(e){}
  return null;
}
function ensureSafepaysReferralCode(user){return String(user?.referralCode||'').trim().toUpperCase();}
async function copyText(text){
  const value=String(text??'').trim();
  if(!value)return false;
  let ok=false;
  try{
    if(navigator.clipboard && window.isSecureContext){await navigator.clipboard.writeText(value);ok=true;}
  }catch(e){}
  if(!ok){
    try{
      const ta=document.createElement('textarea');
      ta.value=value; ta.setAttribute('readonly','');
      ta.style.position='fixed'; ta.style.opacity='0'; ta.style.pointerEvents='none';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0,ta.value.length);
      ok=document.execCommand('copy'); ta.remove();
    }catch(e){}
  }
  if(ok) toast('Referans kodu kopyalandı'); else toast('Kopyalama başarısız. Kodu basılı tutarak kopyalayabilirsiniz.');
  return ok;
}
function sendChat(){location.href='support.html';}

function supportRoutingContext(){return null;}
function requestHuman(){location.href='support.html?topic=human';}
function toggleSupportList(btn){const list=document.getElementById('supportList'); if(list){list.classList.toggle('open');btn.classList.toggle('active')}}
function toggleSupportSummary(btn){const panel=document.getElementById('mobileSupportSummary');if(!panel)return;const open=panel.hidden;panel.hidden=!open;document.querySelectorAll('.support-mobile-tabs button').forEach(b=>b.classList.remove('active'));if(open){btn?.classList.add('active');renderMobileSupportSummary()}else{document.querySelector('.support-mobile-tabs button:first-child')?.classList.add('active')}}
function renderMobileSupportSummary(){
  const token=localStorage.getItem('safepays_api_token')||'';
  fetch('/api/auth/me',{headers:{Authorization:'Bearer '+token},cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{const u=d?.user||{},balance=document.getElementById('mobileSupportBalance'),ref=document.getElementById('mobileSupportReferral');if(balance)balance.textContent=Number(u.balance||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' USDT';if(ref)ref.textContent=u.referralCode||'—';}).catch(()=>{});
  fetch('/api/transactions',{headers:{Authorization:'Bearer '+token},cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{const rows=(d?.transactions||[]).filter(x=>x.status==='pending'),total=rows.reduce((n,x)=>n+Number(x.amount||0),0),pending=document.getElementById('mobileSupportPending'),sub=document.getElementById('mobileSupportPendingSub');if(pending)pending.textContent=total.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' USDT';if(sub)sub.textContent=rows.length?rows.length+' bekleyen işlem':'Bekleyen işlem yok';}).catch(()=>{});
}
function quickAsk(text){const input=document.getElementById('chatInput');if(input){input.value=String(text||'');if(typeof sendSupportMessage==='function')sendSupportMessage();}}
function getSupportUserKey(){return '';}
function readSupportMessages(){return [];}
function saveSupportMessage(){}
function renderSupportMessages(){const box=document.getElementById('supportMessages');if(box)box.textContent='Mesajlarınızı Destek sayfasından destek ekibine iletin.';}
function sendSupportMessage(){location.href='support.html';}
function supportReply(){return 'Mesajınızı Destek sayfasından destek ekibine iletin.';}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function searchSupportTx(){const input=document.getElementById('txSearch'),out=document.getElementById('txResult');if(!input||!out)return;try{const t=localStorage.getItem('safepays_api_token')||'',r=await fetch('/api/transactions',{headers:{Authorization:'Bearer '+t},cache:'no-store'}),d=await r.json(),q=input.value.trim().toLowerCase(),tx=(d.transactions||[]).find(x=>String(x.id||'').toLowerCase()===q||String(x.txHash||'').toLowerCase()===q);out.textContent=tx?tx.type+' · '+tx.id+' · '+tx.status+' · '+tx.amount+' USDT':'Bu hesapta eşleşen işlem bulunamadı.';}catch(_){out.textContent='İşlem bilgisi alınamadı.';}}

/* Safepays v73 — unified, touch-safe language + theme controls */
(function(){
  const langs=[['tr','🇹🇷','Türkçe'],['en','🇬🇧','English'],['de','🇩🇪','Deutsch'],['fr','🇫🇷','Français'],['es','🇪🇸','Español'],['it','🇮🇹','Italiano'],['pt','🇵🇹','Português'],['nl','🇳🇱','Nederlands'],['pl','🇵🇱','Polski'],['ru','🇷🇺','Русский'],['uk','🇺🇦','Українська'],['ar','🇸🇦','العربية'],['fa','🇮🇷','فارسی'],['he','🇮🇱','עברית'],['el','🇬🇷','Ελληνικά'],['ro','🇷🇴','Română'],['bg','🇧🇬','Български'],['sr','🇷🇸','Srpski'],['hr','🇭🇷','Hrvatski'],['az','🇦🇿','Azərbaycan'],['kk','🇰🇿','Қазақша'],['uz','🇺🇿','O‘zbekcha'],['hi','🇮🇳','हिन्दी'],['id','🇮🇩','Bahasa Indonesia'],['ms','🇲🇾','Bahasa Melayu'],['th','🇹🇭','ไทย'],['vi','🇻🇳','Tiếng Việt'],['zh-CN','🇨🇳','简体中文'],['ja','🇯🇵','日本語'],['ko','🇰🇷','한국어']];
  const rtl=['ar','fa','he','ur'];
  const esc=s=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const savedLang=()=>{try{return localStorage.getItem('safepays-language')||'tr'}catch(e){return 'tr'}};
  function apply(code){
    const f=langs.find(x=>x[0]===code)||langs[0];
    try{localStorage.setItem('safepays-language',f[0]);localStorage.setItem('safepays-language-name',f[2]);localStorage.setItem('safepays-language-flag',f[1])}catch(e){}
    document.documentElement.lang=f[0];document.documentElement.dir=rtl.includes(f[0])?'rtl':'ltr';
    document.querySelectorAll('.sp-page-lang').forEach(w=>{
      const flag=w.querySelector('.sp-page-flag'); if(flag) flag.textContent=f[1];
      const codeEl=w.querySelector('.sp-lang-code'); if(codeEl) codeEl.textContent=f[0].startsWith('zh')?'ZH':f[0].toUpperCase();
      w.querySelectorAll('.sp-lang-option').forEach(o=>o.classList.toggle('selected',o.dataset.lang===f[0]));
    });
    window.dispatchEvent(new CustomEvent('safepays-language-change',{detail:{code:f[0]}}));
    window.SafepaysI18n?.apply?.();
  }
  function closeMenus(){document.querySelectorAll('.sp-lang-menu.open').forEach(m=>m.classList.remove('open'));document.querySelectorAll('.sp-lang-trigger[aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'))}
  function langUI(host){
    if(document.querySelector('.sp-page-lang')) return document.querySelector('.sp-page-lang');
    const saved=savedLang(), found=langs.find(x=>x[0]===saved)||langs[0];
    const wrap=document.createElement('div');wrap.className='sp-page-lang language-picker';
    wrap.innerHTML='<button type="button" class="sp-lang-trigger" aria-haspopup="listbox" aria-expanded="false" aria-label="Dil seçimi"><span class="sp-page-flag">'+found[1]+'</span><span class="sp-lang-code">'+(found[0].startsWith('zh')?'ZH':found[0].toUpperCase())+'</span><span class="sp-page-chevron">⌄</span></button><div class="sp-lang-menu" role="listbox">'+langs.map(x=>'<button type="button" class="sp-lang-option" role="option" data-lang="'+esc(x[0])+'"><span class="lang-flag">'+x[1]+'</span><span class="lang-name">'+esc(x[2])+'</span><span class="lang-code">'+(x[0].startsWith('zh')?'ZH':x[0].toUpperCase())+'</span></button>').join('')+'</div>';
    const trigger=wrap.querySelector('.sp-lang-trigger'),menu=wrap.querySelector('.sp-lang-menu');
    trigger.addEventListener('click',e=>{e.stopPropagation();const open=!menu.classList.contains('open');closeMenus();if(open){menu.classList.add('open');trigger.setAttribute('aria-expanded','true')}});
    wrap.querySelectorAll('.sp-lang-option').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();apply(btn.dataset.lang);closeMenus()}));
    if(host) host.appendChild(wrap); else document.body.appendChild(wrap);
    apply(saved);return wrap;
  }
  function themeUI(controls){
    if(document.getElementById('themeSwitch')) return document.getElementById('themeSwitch');
    const b=document.createElement('button');b.type='button';b.id='themeSwitch';b.className='theme-switch sp-global-theme';b.setAttribute('aria-label','Tema değiştir');
    b.innerHTML='<span class="theme-icon sun" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span><span class="theme-track"><span class="theme-thumb"></span></span><span class="theme-icon moon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg></span>';
    (controls||document.body).appendChild(b);b.addEventListener('click',window.toggleTheme);return b;
  }
  function makeControls(){
    let c=document.getElementById('spPageControls');if(c)return c;c=document.createElement('div');c.id='spPageControls';c.className='sp-page-controls';
    const auth=document.querySelector('.auth-page');if(auth){c.classList.add('auth-page-controls');(auth.querySelector('.auth-wrap')||auth).appendChild(c)}else document.body.appendChild(c);return c;
  }
  document.addEventListener('click',closeMenus);
  document.addEventListener('DOMContentLoaded',function(){
    // v90: controls intentionally removed; keep language state for translation only.
    document.querySelectorAll('.sp-page-controls,.auth-page-controls,.sp-page-lang,#themeSwitch,.theme-switch').forEach(el=>el.remove());
    apply(savedLang());
  });
})();


/* V94 — mobile navigation follows the current page instead of always highlighting Home. */
function initSafepaysMobileNav(){
  const current=(location.pathname.split('/').pop()||'dashboard.html').toLowerCase();
  let target=current;
  if(current==='deposit.html'||current==='withdraw.html') target='finance.html';
  document.querySelectorAll('.mobile-nav a').forEach(a=>{
    const href=(a.getAttribute('href')||'').split('?')[0].split('#')[0].split('/').pop().toLowerCase();
    const active=href===target || (target==='' && href==='dashboard.html');
    a.classList.toggle('active',active);
    const label=a.querySelector('span');
    if(label && href==='support.html'){ label.textContent='Canlı Destek'; label.classList.add('support-nav-label'); label.setAttribute('data-i18n-source','Canlı Destek'); }
  });
}
document.addEventListener('DOMContentLoaded', initSafepaysMobileNav);
initSafepaysMobileNav();


document.addEventListener('DOMContentLoaded',syncSafepaysHeaderUser);

/* Landing polish — public header hamburger toggle */
(function(){
  function closePublicNav(){
    const header=document.querySelector('.public-header');
    const btn=document.getElementById('publicMenuToggle');
    if(!header||!btn)return;
    header.classList.remove('nav-open');
    btn.setAttribute('aria-expanded','false');
    btn.setAttribute('aria-label','Menüyü aç');
  }
  function togglePublicNav(){
    const header=document.querySelector('.public-header');
    const btn=document.getElementById('publicMenuToggle');
    if(!header||!btn)return;
    const open=!header.classList.contains('nav-open');
    header.classList.toggle('nav-open',open);
    btn.setAttribute('aria-expanded',String(open));
    btn.setAttribute('aria-label',open?'Menüyü kapat':'Menüyü aç');
  }
  document.addEventListener('DOMContentLoaded',function(){
    const btn=document.getElementById('publicMenuToggle');
    const nav=document.getElementById('publicNav');
    if(!btn||!nav)return;
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      togglePublicNav();
    });
    nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closePublicNav));
    document.addEventListener('click',function(e){
      const header=document.querySelector('.public-header');
      if(!header||!header.classList.contains('nav-open'))return;
      if(!header.contains(e.target)) closePublicNav();
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape') closePublicNav();
    });
    window.addEventListener('resize',function(){
      if(window.innerWidth>900) closePublicNav();
    });
  });
})();
