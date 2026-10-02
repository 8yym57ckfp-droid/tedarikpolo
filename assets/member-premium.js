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
  const selector='.card,.dash-card,.assets-summary,.balance-card,.network-invest,.network-invest-card,.quick,.ref-banner,.transaction-card,.history-card,.profile,.support-card,.support-panel,.security-card,.notice-card,.event-card,.panel,.wallet-card,.form-card,.auth-card';
  const cards=[...document.querySelectorAll(selector)].filter(el=>!el.closest('.admin-side,.admin-nav,.mobile-nav,.public-header,header')&&!el.classList.contains('member-depth-ambient'));
  for(const [index,card] of cards.entries()){card.classList.add('member-depth-card');card.style.setProperty('--member-depth-order',index%2?'1':'-1')}
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
        const shift=Math.max(-7,Math.min(7,-offset*5));
        const tilt=Math.max(-.8,Math.min(.8,-offset*.58));
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
