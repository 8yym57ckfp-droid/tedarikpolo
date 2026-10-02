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
  const cards=[...document.querySelectorAll(selector)].filter(el=>!el.closest('.admin-side,.admin-nav,.mobile-nav,.public-header,header')&&!el.classList.contains('member-depth-ambient'));
  for(const [index,card] of cards.entries()){card.classList.add('member-depth-card');card.style.setProperty('--member-depth-side',index%2?'1.8deg':'-1.8deg')}
  if(reduced||!('IntersectionObserver'in window)){cards.forEach(card=>card.classList.add('member-depth-visible'));return}
  const visible=new Set();
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(entry.isIntersecting){entry.target.classList.add('member-depth-visible');visible.add(entry.target)}
      else visible.delete(entry.target);
    }
    updateDepth();
  },{threshold:.03,rootMargin:'0px 0px -4% 0px'});
  cards.forEach(card=>observer.observe(card));
  let raf=0;
  function updateDepth(){
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      const viewport=innerHeight||1;
      for(const card of visible){
        const rect=card.getBoundingClientRect();
        const offset=(rect.top+rect.height*.45-viewport*.5)/viewport;
        const shift=Math.max(-16,Math.min(16,-offset*12));
        const tilt=Math.max(-2.4,Math.min(2.4,-offset*1.9));
        card.style.setProperty('--member-depth-y',shift.toFixed(2)+'px');
        card.style.setProperty('--member-depth-r',tilt.toFixed(2)+'deg');
      }
      document.body.style.setProperty('--member-scroll-depth',(scrollY||0)+'px');
    });
  }
  addEventListener('scroll',updateDepth,{passive:true});
  addEventListener('resize',updateDepth,{passive:true});
  updateDepth();
})();
