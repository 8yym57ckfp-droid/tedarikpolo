(()=>{
  if(!document.body)return;
  document.body.classList.add('member-premium');
  document.body.dataset.memberTheme='solar';

  const ambient=document.createElement('div');
  ambient.className='member-depth-ambient';
  ambient.setAttribute('aria-hidden','true');
  ambient.innerHTML='<i class="member-depth-orb one"></i><i class="member-depth-orb two"></i><i class="member-depth-orb three"></i><i class="member-depth-ring"></i><i class="member-depth-ring ring-two"></i>';
  document.body.prepend(ambient);
  for(const child of document.body.children){
    if(child===ambient||child.tagName==='SCRIPT'||child.tagName==='STYLE')continue;
    if(getComputedStyle(child).position==='static')child.style.position='relative';
    if(getComputedStyle(child).zIndex==='auto')child.style.zIndex='1';
  }

  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const selector='.card,.dash-card,.assets-summary,.balance-card,.finance-card,.network-invest,.network-invest-card,.quick,.ref-banner,.transaction-card,.history-card,.profile,.support-card,.support-panel,.chat-panel,.context-card,.support-categories,.support-category,.support-compose,.security-card,.security-row,.security-grid,.security-hero,.account-card,.account-grid,.danger-zone,.notice-card,.event-card,.panel,.wallet-card,.wallet-summary-card,.wallet-secure-panel,.wallet-activity-panel,.form-card,.auth-card,.auth,.member-earning-guide,.wallet-layout-grid>section,.activity-panel,.balance-panel,.transactions-card,.pending-card,.ref-card,.ref-page,.ref-stat,.recent-card,.campaign,.overview-hero,.quick-action,.quick-actions,.balance-history-panel,.table-wrap,.stat-card,.info-card,.ticket,.session,.pl-globe-stage,.pl-join-card';
  const cards=new Set(),visible=new Set();
  let raf=0;

  function updateDepth(){
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      const viewport=innerHeight||1;
      for(const card of visible){
        const rect=card.getBoundingClientRect();
        const phase=Math.max(-1.25,Math.min(1.25,(rect.top+rect.height*.5-viewport*.5)/viewport));
        const distance=Math.abs(phase);
        const side=Number(card.dataset.depthSide||1);
        const y=Math.max(-34,Math.min(34,phase*27));
        const z=-Math.min(142,distance*118);
        const tilt=Math.max(-13,Math.min(13,-phase*11));
        const turn=Math.sin(phase*2.25)*4.2+side*1.25;
        const x=Math.sin(phase*2.1+side)*Math.min(13,distance*12);
        const scale=1-Math.min(.065,distance*.052);
        card.style.setProperty('--member-depth-x',x.toFixed(2)+'px');
        card.style.setProperty('--member-depth-y',y.toFixed(2)+'px');
        card.style.setProperty('--member-depth-z',z.toFixed(2)+'px');
        card.style.setProperty('--member-depth-r',tilt.toFixed(2)+'deg');
        card.style.setProperty('--member-depth-side',turn.toFixed(2)+'deg');
        card.style.setProperty('--member-depth-side-mobile',(turn*.45).toFixed(2)+'deg');
        card.style.setProperty('--member-depth-scale',scale.toFixed(4));
      }
      const maxScroll=Math.max(1,document.documentElement.scrollHeight-viewport);
      const progress=Math.max(0,Math.min(1,(scrollY||0)/maxScroll));
      document.body.style.setProperty('--member-scroll-progress',progress.toFixed(4));
      ambient.style.setProperty('--member-parallax-y',(-scrollY*.24).toFixed(2)+'px');
      ambient.style.setProperty('--member-grid-y',(-scrollY*.14).toFixed(2)+'px');
      ambient.style.setProperty('--member-ring-y',(-scrollY*.19).toFixed(2)+'px');
      ambient.style.setProperty('--member-ring-y-secondary',(-scrollY*.13).toFixed(2)+'px');
    });
  }

  const observer=reduced||!('IntersectionObserver'in window)?null:new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(entry.isIntersecting){entry.target.classList.add('member-depth-visible');visible.add(entry.target)}
      else visible.delete(entry.target);
    }
    updateDepth();
  },{threshold:0,rootMargin:'12% 0px 12% 0px'});

  function registerCard(card){
    if(cards.has(card)||card.closest('.admin-side,.admin-nav,.mobile-nav,.public-header,header'))return;
    cards.add(card);
    card.classList.add('member-depth-card','member-depth-visible');
    const side=cards.size%2?-1:1;
    card.dataset.depthSide=String(side);
    card.style.setProperty('--member-depth-side',(side*1.25)+'deg');
    if(observer)observer.observe(card);else visible.add(card);
  }
  function scan(node){
    if(node.nodeType!==1)return;
    if(node.matches(selector))registerCard(node);
    node.querySelectorAll(selector).forEach(registerCard);
  }
  document.querySelectorAll(selector).forEach(registerCard);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
  addEventListener('scroll',updateDepth,{passive:true});
  addEventListener('resize',updateDepth,{passive:true});
  updateDepth();
})();
