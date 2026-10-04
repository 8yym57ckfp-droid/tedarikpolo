(()=>{
  if(!document.body)return;
  const body=document.body;
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
      const candidates=[...document.querySelectorAll('.dash-header,.topbar,.member-topbar,.member-header,.page-head,.finance-title')];
      const heading=candidates.find(el=>getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden')||document.querySelector('.main,.main-content,.wrap');
      if(heading&&!heading.querySelector('.member-glass-brand')){
        const brand=document.createElement('a');brand.className='member-glass-brand';brand.href='dashboard.html';brand.setAttribute('aria-label','SafePays ana sayfa');brand.innerHTML=brandMarkup;heading.prepend(brand);
      }
    }
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
    '.pl-hero .hero-copy','.pl-globe-stage','.pl-logo-ticker','.pl-feature-card','.pl-news-card','.pl-how-card','.pl-faq-item','.pl-join-card',
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
