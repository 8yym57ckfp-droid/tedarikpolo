(()=>{
  if(!document.body)return;
  const body=document.body;
  if(!document.getElementById('memberUnifiedStyle')){const style=document.createElement('link');style.id='memberUnifiedStyle';style.rel='stylesheet';style.href='/assets/member-unified.css?v=7';document.head.append(style);}
  body.classList.add('member-premium');
  body.dataset.memberTheme='obsidian';

  document.querySelectorAll('img[src*="safepays-mark.png"]').forEach(img=>{
    img.src='assets/safepays-mark.png?v=2';
  });

  const ambient=document.createElement('div');
  ambient.className='member-depth-ambient';
  ambient.setAttribute('aria-hidden','true');
  ambient.innerHTML='<i class="member-depth-orb one"></i><i class="member-depth-orb two"></i><i class="member-depth-orb three"></i><i class="member-depth-ring"></i><i class="member-depth-ring ring-two"></i>';
  body.prepend(ambient);

  if(!body.classList.contains('public-landing')&&!body.classList.contains('auth-public')){
    const current=location.pathname.split('/').pop()||'dashboard.html';
    const routes=[
      ['dashboard.html','Ana Sayfa'],['wallet.html','Cüzdan'],['deposit.html','Yatırım Yap'],
      ['withdraw.html','Çekim Yap'],['balance-history.html','Bakiye Hareketleri'],
      ['transactions.html','İşlem Geçmişi'],['referrals.html','Referanslar'],['events.html','Etkinlikler'],
      ['earnings.html','Kazanç Merkezi'],['support.html','Destek'],['notifications.html','Bildirimler'],
      ['profile.html','Profil & Güvenlik'],['security.html','Güvenlik Merkezi']
    ];
    const routeGroups={
      'dashboard.html':['dashboard.html'],'wallet.html':['wallet.html'],
      'events.html':['events.html'],'finance.html':['finance.html','deposit.html','withdraw.html'],
      'support.html':['support.html']
    };
    const nav= document.querySelector('.mobile-nav')||(()=>{
      const created=document.createElement('nav');created.className='mobile-nav member-shared-mobile-nav';created.setAttribute('aria-label','Ana menü');
      for(const [href,label,icon] of [['dashboard.html','Ana Sayfa','⌂'],['wallet.html','Cüzdan','◈'],['events.html','Etkinlik','✦'],['finance.html','Yatır / Çek','↕'],['support.html','Destek','?']]){
        const link=document.createElement('a');link.href=href;
        const symbol=document.createElement('b');symbol.className='nav-svg';symbol.setAttribute('aria-hidden','true');symbol.textContent=icon;
        const text=document.createElement('span');text.textContent=label;link.append(symbol,text);created.append(link);
      }
      body.append(created);return created;
    })();
    const links=[...nav.querySelectorAll('a')];
    links.forEach(link=>{
      const href=link.getAttribute('href');
      const active=(routeGroups[href]||[href]).includes(current);
      link.classList.toggle('active',active);
      if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
    const brandMarkup='<img src="assets/safepays-mark.png?v=2" alt=""><span class="inline-brand"><b>Safe</b><b>Pays</b></span>';
    const inlineBrand=document.querySelector('.dash-brand-mobile .mobile-inline-logo');
    if(inlineBrand){inlineBrand.classList.add('member-glass-brand');inlineBrand.innerHTML=brandMarkup;}
    else{
      const brandSelector='.member-glass-brand,.member-brand,.mobile-inline-logo';
      const candidates=[...document.querySelectorAll('.dash-header,.topbar,.member-topbar,.member-header')];
      const visibleHeaders=candidates.filter(el=>getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden');
      let heading=visibleHeaders.find(el=>el.querySelector(brandSelector))||visibleHeaders.find(el=>el.matches('.member-topbar'))||visibleHeaders[0];
      const main=document.querySelector('.dash-main,.main,.main-content,main.wrap,main');
      if(!heading&&main){heading=document.createElement('header');heading.className='member-standard-header';main.prepend(heading);}
      if(heading){
        heading.classList.add('member-standard-header');
        const existingBrand=heading.querySelector(brandSelector);
        if(existingBrand){
          existingBrand.classList.add('member-glass-brand');
          existingBrand.innerHTML=brandMarkup;
          heading.querySelectorAll(brandSelector).forEach(node=>{if(node!==existingBrand)node.remove();});
        }else{
          const brand=document.createElement('a');brand.className='member-glass-brand';brand.href='dashboard.html';brand.setAttribute('aria-label','SafePays ana sayfa');brand.innerHTML=brandMarkup;heading.prepend(brand);
        }
      }
    }
    const standardHeader=inlineBrand?.closest('.dash-header')||document.querySelector('.member-standard-header');
    if(standardHeader){
      standardHeader.classList.add('member-standard-header');
      const headerBrand=standardHeader.querySelector('.member-glass-brand,.member-brand,.mobile-inline-logo');
      standardHeader.querySelectorAll('.member-glass-brand,.member-brand,.mobile-inline-logo').forEach(node=>{if(node!==headerBrand)node.remove();});
      document.querySelectorAll('.dash-header,.topbar,.member-topbar,.member-header').forEach(candidate=>{
        if(candidate!==standardHeader)candidate.querySelectorAll('.member-glass-brand,.member-brand,.mobile-inline-logo').forEach(node=>node.remove());
      });
      let profileMenu=standardHeader.querySelector('.member-profile-menu');
      let profileTrigger=profileMenu?.querySelector('.member-header-profile')||standardHeader.querySelector('.user-pill,.member-header-profile,.profile,.member-avatar');
      if(!profileMenu){
        profileMenu=document.createElement('div');profileMenu.className='member-profile-menu';
        if(profileTrigger){profileTrigger.parentNode.insertBefore(profileMenu,profileTrigger);profileMenu.append(profileTrigger);}
        else{standardHeader.append(profileMenu);profileTrigger=document.createElement('button');profileTrigger.type='button';profileTrigger.className='member-header-profile';profileTrigger.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/></svg>';profileMenu.append(profileTrigger);}
      }
      profileTrigger=profileMenu.querySelector('.member-header-profile,.user-pill,.profile,.member-avatar');
      profileTrigger.classList.add('member-header-profile');profileTrigger.setAttribute('aria-label','Profil menüsünü aç');profileTrigger.setAttribute('aria-haspopup','menu');profileTrigger.setAttribute('aria-expanded','false');
      if(profileTrigger.tagName==='A'&&!profileTrigger.hasAttribute('href'))profileTrigger.href='profile.html';
      if(!profileMenu.querySelector('.member-profile-dropdown')){
        const menu=document.createElement('div');menu.className='member-profile-dropdown';menu.setAttribute('role','menu');menu.hidden=true;
        menu.innerHTML='<a role="menuitem" href="profile.html"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/></svg><span>Profilim</span></a><a role="menuitem" href="security.html"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.8 7.4-7 10-4.2-2.6-7-5.5-7-10V6z"/><path d="m9 12 2 2 4-4"/></svg><span>Güvenlik</span></a><button type="button" role="menuitem" data-member-logout><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9"/></svg><span>Çıkış yap</span></button>';
        profileMenu.append(menu);
      }
      if(!standardHeader.querySelector('.member-rate-indicator')){
        const rates=document.createElement('div');rates.className='member-rate-indicator';rates.setAttribute('aria-label','TRC20 ve ERC20 güncel USDT fiyat ve ağ ücreti');
        rates.innerHTML='<span class="member-rate-caption"><i></i> CANLI USDT · TRY</span><div class="member-rate-networks"><div class="member-rate-network trc"><b>TRC20</b><strong data-rate-price>Yükleniyor</strong><small>Ağ ücreti <span data-rate-fee>—</span></small></div><div class="member-rate-network erc"><b>ERC20</b><strong data-rate-price>Yükleniyor</strong><small>Ağ ücreti <span data-rate-fee>—</span></small></div></div>';
        profileMenu.parentNode.insertBefore(rates,profileMenu);
      }
      if(!window.__memberProfileMenuBound){
        window.__memberProfileMenuBound=true;
        document.addEventListener('click',event=>{
          const trigger=event.target.closest('.member-profile-menu>.member-header-profile,.member-profile-menu>.user-pill,.member-profile-menu>.profile,.member-profile-menu>.member-avatar');
          if(trigger){if(trigger.tagName==='A')event.preventDefault();const wrap=trigger.closest('.member-profile-menu'),menu=wrap.querySelector('.member-profile-dropdown'),open=menu.hidden;document.querySelectorAll('.member-profile-dropdown').forEach(item=>{item.hidden=true;item.closest('.member-profile-menu')?.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded','false');});menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));return;}
          const logout=event.target.closest('[data-member-logout]');
          if(logout){const token=localStorage.getItem('safepays_api_token')||'';localStorage.removeItem('safepays_api_token');fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token},cache:'no-store'}).catch(()=>{}).finally(()=>location.replace('login.html'));return;}
          if(!event.target.closest('.member-profile-menu'))document.querySelectorAll('.member-profile-dropdown').forEach(item=>{item.hidden=true;item.closest('.member-profile-menu')?.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded','false');});
        });
        document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.member-profile-dropdown').forEach(item=>{item.hidden=true;item.closest('.member-profile-menu')?.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded','false');});});
      }
    }
    document.querySelectorAll('.member-standard-header .wallet-balance-pill,.member-standard-header .member-balance-pill,.dash-header .wallet-balance-pill,.dash-content .welcome>.wallet-balance-card').forEach(el=>el.remove());
    document.querySelectorAll('.side nav a').forEach(link=>{
      const label=link.textContent.replace(/\s+/g,' ').trim();
      if(label){link.dataset.memberLabel=label;link.setAttribute('aria-label',label);}
    });
    if(!document.querySelector('.mobile-nav')){
      const nav=document.createElement('nav');nav.className='mobile-nav member-shared-mobile-nav';nav.setAttribute('aria-label','Ana menü');
      for(const [href,label,icon] of [['dashboard.html','Ana Sayfa','⌂'],['wallet.html','Cüzdan','◈'],['events.html','Etkinlik','✦'],['finance.html','Yatır / Çek','↕'],['support.html','Destek','?']]){
        const link=document.createElement('a');link.href=href;if(current===href)link.classList.add('active');
        const symbol=document.createElement('b');symbol.className='nav-svg';symbol.setAttribute('aria-hidden','true');symbol.textContent=icon;
        const text=document.createElement('span');text.textContent=label;link.append(symbol,text);nav.append(link);
      }
      body.append(nav);
    }
  }

  for(const child of body.children){
    if(child===ambient||child.tagName==='SCRIPT'||child.tagName==='STYLE')continue;
    const style=getComputedStyle(child);
    if(style.position==='static')child.style.position='relative';
    if(style.zIndex==='auto')child.style.zIndex='1';
  }

  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const selector=[
    '.pl-hero .hero-copy','.pl-globe-stage','.pl-logo-ticker','.pl-feature-card','.pl-news-card','.pl-how-card','.pl-join-card',
    '.dash-content>.balance-grid','.dash-content>.dashboard-published-feed','.dash-content>.network-live-panel','.dash-content>.assets-summary',
    '.dash-content>.member-earning-guide','.dash-content>.network-invest','.dash-content>.quick-grid>.quick',
    '.dash-content #publishedContent .events-grid>.event-card',
    '.dash-content>.dash-two>.dash-card','.dash-content>.dash-two>.ref-banner','.dash-content>.tx-card',
    '.main>.finance-card','.main>.support-panel','.main>.security-hero','.main>.account-card',
    '.finance-page>.finance-card','.finance-page>.support-panel','.finance-page>.wallet-summary-card',
    '.main>.ref-card','.main>.ref-page','.main>.event-card','.main>.history-card','.main>.transactions-card',
    '.main>.campaign','.main>.stat-card','.main>.info-card','.main>.profile','.auth-wrap>.auth',
    '.support-shell>.support-panel','.wallet-page>.wallet-summary-card','.wallet-page>.wallet-secure-panel',
    '.wallet-page>.wallet-activity-panel'
  ].join(',');
  const cards=new Set(),visible=new Set();
  let raf=0;

  function updateDepth(){
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      const viewport=innerHeight||1;
      for(const card of cards){
        const rect=card.getBoundingClientRect();
        const phase=Math.max(-1.15,Math.min(1.15,(rect.top+rect.height*.5-viewport*.5)/viewport));
        const distance=Math.abs(phase);
        const side=Number(card.dataset.depthSide||1);
        const x=Math.sin(phase*1.7+side)*Math.min(16,distance*14);
        const y=Math.max(-38,Math.min(38,phase*32));
        const z=-Math.min(110,distance*94);
        const tilt=Math.max(-8,Math.min(8,-phase*7));
        const turn=Math.sin(phase*1.7)*3.2+side*1.1;
        const scale=1-Math.min(.055,distance*.042);
        card.style.setProperty('--member-depth-x',x.toFixed(2)+'px');
        card.style.setProperty('--member-depth-y',y.toFixed(2)+'px');
        card.style.setProperty('--member-depth-z',z.toFixed(2)+'px');
        card.style.setProperty('--member-depth-r',tilt.toFixed(2)+'deg');
        card.style.setProperty('--member-depth-side',turn.toFixed(2)+'deg');
        card.style.setProperty('--member-depth-scale',scale.toFixed(4));
      }
      const maxScroll=Math.max(1,document.documentElement.scrollHeight-viewport);
      const progress=Math.max(0,Math.min(1,(scrollY||0)/maxScroll));
      body.style.setProperty('--member-scroll-progress',progress.toFixed(4));
      body.style.setProperty('--member-hero-rotate-y',(-progress*9).toFixed(2)+'deg');
      body.style.setProperty('--member-hero-rotate-x',(progress*4).toFixed(2)+'deg');
      body.style.setProperty('--member-ticker-rotate',(-progress*3).toFixed(2)+'deg');
      body.style.setProperty('--member-join-rotate',(progress*3).toFixed(2)+'deg');
      ambient.style.setProperty('--member-parallax-y',(-scrollY*.21).toFixed(2)+'px');
      ambient.style.setProperty('--member-grid-y',(-scrollY*.12).toFixed(2)+'px');
      ambient.style.setProperty('--member-ring-y',(-scrollY*.18).toFixed(2)+'px');
      ambient.style.setProperty('--member-ring-y-secondary',(-scrollY*.11).toFixed(2)+'px');
    });
  }

  const observer=reduced||!('IntersectionObserver'in window)?null:new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(entry.isIntersecting){entry.target.classList.add('member-depth-visible');visible.add(entry.target)}
      else{entry.target.classList.remove('member-depth-visible');visible.delete(entry.target)}
    }
    updateDepth();
  },{threshold:0,rootMargin:'10% 0px 10% 0px'});

  function registerCard(card){
    if(cards.has(card)||card.closest('.side,.mobile-nav,.public-header,header,.auth-scene'))return;
    cards.add(card);
    card.classList.add('member-depth-card');
    card.dataset.depthSide=String(cards.size%2?-1:1);
    if(observer)observer.observe(card);else{card.classList.add('member-depth-visible');visible.add(card)}
  }
  document.querySelectorAll('.public-landing .pl-faq-item').forEach(card=>{
    const resetTilt=()=>{
      card.style.setProperty('--faq-tilt-x','0deg');
      card.style.setProperty('--faq-tilt-y','0deg');
    };
    card.addEventListener('pointermove',event=>{
      if(event.pointerType==='touch')return;
      const rect=card.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      const x=(event.clientX-rect.left)/rect.width-.5;
      const y=(event.clientY-rect.top)/rect.height-.5;
      card.style.setProperty('--faq-tilt-x',(-y*2.4).toFixed(2)+'deg');
      card.style.setProperty('--faq-tilt-y',(x*2.4).toFixed(2)+'deg');
    });
    card.addEventListener('pointerleave',resetTilt);
    card.addEventListener('pointercancel',resetTilt);
    card.addEventListener('focusout',event=>{if(!card.contains(event.relatedTarget))resetTilt();});
  });
  document.querySelectorAll('a[href*="deposit.html"],#tabDeposit').forEach(el=>el.classList.add('member-flow-deposit'));
  document.querySelectorAll('a[href*="withdraw.html"],#tabWithdraw').forEach(el=>el.classList.add('member-flow-withdraw'));
  async function refreshMemberRates(){
    const indicator=document.querySelector('.member-rate-indicator');if(!indicator)return;
    try{
      const response=await fetch('/api/rates',{cache:'no-store'});if(!response.ok)throw new Error('rate_unavailable');
      const data=await response.json(),price=Number(data.safepaysRate),format=(n,d=2)=>Number(n||0).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d});
      indicator.querySelectorAll('[data-rate-price]').forEach(node=>node.textContent=Number.isFinite(price)?`₺${format(price,4)}`:'—');
      indicator.querySelector('[data-rate-fee]').textContent=`${format(data.networks?.TRC20?.feeUsdt)} USDT`;
      indicator.querySelectorAll('[data-rate-fee]')[1].textContent=`${format(data.networks?.ERC20?.feeUsdt)} USDT`;
      indicator.dataset.stale=data.stale?'true':'false';indicator.title=data.updatedAt?`Güncelleme: ${new Date(data.updatedAt).toLocaleTimeString('tr-TR')}`:'';
    }catch(_){indicator.dataset.stale='true';indicator.querySelectorAll('[data-rate-price]').forEach(node=>node.textContent='—');}
  }
  if(document.querySelector('.member-rate-indicator')){refreshMemberRates();setInterval(refreshMemberRates,30000);}
  function scan(node){
    if(node.nodeType!==1)return;
    if(node.matches(selector))registerCard(node);
    node.querySelectorAll(selector).forEach(registerCard);
  }
  document.querySelectorAll(selector).forEach(registerCard);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(scan))).observe(body,{childList:true,subtree:true});
  addEventListener('scroll',updateDepth,{passive:true});
  addEventListener('resize',updateDepth,{passive:true});
  updateDepth();
})();
