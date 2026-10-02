(()=>{
  if(!document.body||document.body.classList.contains('public-landing'))return;
  document.body.classList.add('member-premium');
  const ambient=document.createElement('div');
  ambient.className='member-depth-ambient';
  ambient.setAttribute('aria-hidden','true');
  ambient.innerHTML='<i class="member-depth-orb one"></i><i class="member-depth-orb two"></i><i class="member-depth-orb three"></i>';
  document.body.prepend(ambient);
  for(const child of document.body.children){
    if(child===ambient||child.tagName==='SCRIPT'||child.tagName==='STYLE')continue;
    if(getComputedStyle(child).position==='static')child.style.position='relative';
    if(getComputedStyle(child).zIndex==='auto')child.style.zIndex='1';
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const selector='.card,.dash-card,.assets-summary,.balance-card,.finance-card,.network-invest,.network-invest-card,.quick,.ref-banner,.transaction-card,.history-card,.profile,.support-card,.support-panel,.chat-panel,.context-card,.support-categories,.support-category,.support-compose,.security-card,.security-row,.security-grid,.security-hero,.account-card,.account-grid,.danger-zone,.notice-card,.event-card,.panel,.wallet-card,.wallet-summary-card,.wallet-secure-panel,.wallet-activity-panel,.form-card,.auth-card,.auth,.member-earning-guide,.wallet-layout-grid>section,.activity-panel,.balance-panel,.transactions-card,.pending-card,.ref-card,.ref-page,.ref-stat,.recent-card,.campaign,.overview-hero,.quick-action,.quick-actions,.balance-history-panel';
  const cards=new Set(),visible=new Set();
  let raf=0;
  function updateDepth(){
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      const viewport=innerHeight||1;
      for(const card of visible){
        const rect=card.getBoundingClientRect();
        const offset=(rect.top+rect.height*.45-viewport*.5)/viewport;
        const shift=Math.max(-26,Math.min(26,-offset*19));
        const tilt=Math.max(-4.5,Math.min(4.5,-offset*3.5));
        card.style.setProperty('--member-depth-y',shift.toFixed(2)+'px');
        card.style.setProperty('--member-depth-r',tilt.toFixed(2)+'deg');
      }
      document.body.style.setProperty('--member-scroll-depth',(scrollY||0)+'px');
    });
  }
  const observer=reduced||!('IntersectionObserver'in window)?null:new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(entry.isIntersecting){entry.target.classList.add('member-depth-visible');visible.add(entry.target)}
      else visible.delete(entry.target);
    }
    updateDepth();
  },{threshold:.03,rootMargin:'0px 0px -4% 0px'});
  function registerCard(card){
    if(cards.has(card)||card.closest('.admin-side,.admin-nav,.mobile-nav,.public-header,header'))return;
    cards.add(card);card.classList.add('member-depth-card');
    card.style.setProperty('--member-depth-side',cards.size%2?'2.5deg':'-2.5deg');
    if(observer)observer.observe(card);
    else card.classList.add('member-depth-visible');
  }
  function scan(node){
    if(node.nodeType!==1)return;
    if(node.matches(selector))registerCard(node);
    node.querySelectorAll(selector).forEach(registerCard);
  }
  document.querySelectorAll(selector).forEach(registerCard);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(scan))).observe(document.body,{childList:true,subtree:true});
  if(!observer)return;
  addEventListener('scroll',updateDepth,{passive:true});
  addEventListener('resize',updateDepth,{passive:true});
  updateDepth();
})();
