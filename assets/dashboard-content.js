(async function(){
 const grid=document.getElementById('dashboardPublishedContent');if(!grid)return;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 try{
  const response=await fetch('/api/content',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error();
  const items=(data.items||[]).filter(x=>x.published!==false&&['news','event'].includes(x.kind)).sort((x,y)=>new Date(y.createdAt||0)-new Date(x.createdAt||0)).slice(0,3);
  grid.innerHTML=items.length?items.map(x=>{const isEvent=x.kind==='event',meta=isEvent?[x.reward,x.deadline].filter(Boolean).join(' · '):new Date(x.createdAt||Date.now()).toLocaleDateString('tr-TR');const media=x.image?'<img src="'+esc(x.image)+'" alt="">':(isEvent?'🎉':'S');return '<a class="dashboard-published-card" href="events.html"><span class="dashboard-published-media">'+media+'</span><span class="dashboard-published-copy"><span class="dashboard-published-kind '+(isEvent?'is-event':'')+'">'+(isEvent?'ETKİNLİK':'HABER')+'</span><strong>'+esc(x.title)+'</strong><small>'+esc(x.excerpt)+(meta?' · '+esc(meta):'')+'</small></span></a>';}).join(''):'<div class="dashboard-published-state">Şu anda yayınlanmış haber veya etkinlik yok.</div>';
 }catch(_){grid.innerHTML='<div class="dashboard-published-state">Güncel içerikler şu anda yüklenemedi. Lütfen biraz sonra tekrar deneyin.</div>';}
})();
