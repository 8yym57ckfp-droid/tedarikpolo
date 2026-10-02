(function(){
 const fmt=n=>Number(n||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:8})+' USDT';
 const money=n=>Number(n||0).toLocaleString('tr-TR',{maximumFractionDigits:8});
 const pad=n=>String(n).padStart(2,'0');
 const localDate=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
 const startEl=document.getElementById('startDate'),endEl=document.getElementById('endDate'),rowsEl=document.getElementById('rows'),barsEl=document.getElementById('bars');
 let transactions=[];
 function render(){
  let s=startEl.value,e=endEl.value;if(!s||!e)return;if(s>e){[s,e]=[e,s];startEl.value=s;endEl.value=e;}
  const filtered=transactions.filter(x=>x.status==='approved'&&(x.type==='deposit'||x.type==='withdrawal')&&localDate(new Date(x.decisionAt||x.createdAt))>=s&&localDate(new Date(x.decisionAt||x.createdAt))<=e);
  const deposits=filtered.filter(x=>x.type==='deposit'),withdrawals=filtered.filter(x=>x.type==='withdrawal');
  const dep=deposits.reduce((a,x)=>a+Number(x.amount||0),0),wd=withdrawals.reduce((a,x)=>a+Number(x.amount||0),0);
  document.getElementById('dep').textContent=fmt(dep);document.getElementById('wd').textContent=fmt(wd);document.getElementById('net').textContent=fmt(dep-wd);document.getElementById('count').textContent=String(filtered.length);
  document.getElementById('commission').textContent='Yapılandırılmadı';document.getElementById('receivable').textContent='Hesaplanmıyor';document.getElementById('cash').textContent='—';document.getElementById('avgDeposit').textContent=fmt(deposits.length?dep/deposits.length:0);
  document.getElementById('periodNote').textContent='Dönem: '+new Date(s+'T00:00:00').toLocaleDateString('tr-TR')+' — '+new Date(e+'T00:00:00').toLocaleDateString('tr-TR');
  const map={};filtered.forEach(x=>{const d=localDate(new Date(x.decisionAt||x.createdAt));map[d]??={deposit:0,withdrawal:0,count:0};map[d][x.type]+=Number(x.amount||0);map[d].count++;});
  const dates=Object.keys(map).sort();rowsEl.innerHTML=dates.length?dates.map(d=>{const x=map[d];return `<tr><td>${new Date(d+'T00:00:00').toLocaleDateString('tr-TR')}</td><td>${fmt(x.deposit)}</td><td>${fmt(x.withdrawal)}</td><td>${fmt(x.deposit-x.withdrawal)}</td><td>${x.count}</td></tr>`;}).join(''):'<tr><td class="empty-row" colspan="5">Seçilen dönemde onaylı kayıt yok.</td></tr>';
  const max=Math.max(1,...dates.map(d=>Math.max(map[d].deposit,map[d].withdrawal)));barsEl.innerHTML=dates.length?dates.map(d=>{const x=map[d],a=Math.max(2,x.deposit/max*190),b=Math.max(2,x.withdrawal/max*190);return `<div class="bar-group"><div class="bar-value">${money(x.deposit+x.withdrawal)}</div><div class="bar-stack"><div class="bar deposit" style="height:${a}px"></div><div class="bar withdraw" style="height:${b}px"></div></div><div class="bar-label">${new Date(d+'T00:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit'})}</div></div>`;}).join(''):'<div style="width:100%;display:grid;place-items:center;color:#7c8ba0;font-size:12px">Seçilen dönemde veri yok.</div>';
 }
 function setRange(days){const end=new Date(),start=new Date(end);if(days==='today')start.setHours(0,0,0,0);else if(days==='all')start.setFullYear(2020,0,1);else{start.setDate(start.getDate()-Number(days)+1);start.setHours(0,0,0,0);}startEl.value=localDate(start);endEl.value=localDate(end);document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('active',b.dataset.range===String(days)));render();}
 document.getElementById('applyBtn').onclick=render;document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>setRange(b.dataset.range));
 const today=new Date();startEl.value=localDate(new Date(today.getFullYear(),today.getMonth(),today.getDate()-29));endEl.value=localDate(today);
 adminFetch('/transactions').then(d=>{transactions=d.transactions||[];render();}).catch(()=>{document.getElementById('rows').innerHTML='<tr><td class="empty-row" colspan="5">Veriler alınamadı.</td></tr>';});
})();
