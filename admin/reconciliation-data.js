(function(){
  const el=id=>document.getElementById(id);
  const money=value=>Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' USDT';
  const pad=value=>String(value).padStart(2,'0');
  const dayKey=date=>date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
  const parseLocal=value=>{const [year,month,day]=value.split('-').map(Number);return new Date(year,month-1,day);};
  const fmtDate=value=>new Date(value+'T00:00:00Z').toLocaleDateString('tr-TR',{timeZone:'UTC'});
  const startEl=el('startDate'),endEl=el('endDate'),rowsEl=el('rows'),barsEl=el('bars');
  const testRunId=new URLSearchParams(location.search).get('testRunId');

  function render(data){
    const totals=data.totals||{},days=data.days||[];
    el('dep').textContent=money(totals.deposit);el('wd').textContent=money(totals.withdrawal);
    el('commission').textContent=data.commissionEnabled?money(totals.commission):'Etkin değil';
    el('receivable').textContent=data.commissionEnabled?money(totals.receivable):'—';
    el('cash').textContent=money(totals.cash);el('avgDeposit').textContent=money(totals.averageDeposit);
    const commissionNote=el('commissionNote');if(commissionNote)commissionNote.textContent=data.commissionEnabled?'Onaylı yatırımlar üzerinden %3 hesaplanır.':'Komisyon modeli etkin değil.';
    el('periodNote').textContent='Dönem: '+fmtDate(data.startDate)+' — '+fmtDate(data.endDate);
    rowsEl.innerHTML=days.length?days.slice().reverse().map(day=>`<tr><td>${fmtDate(day.date)}</td><td>${money(day.deposit)}</td><td>${money(day.withdrawal)}</td><td>${data.commissionEnabled?money(day.commission):'—'}</td><td>${money(day.cash)}</td><td>${data.commissionEnabled?money(day.receivable):'—'}</td><td>${day.count}</td></tr>`).join(''):'<tr><td class="empty-row" colspan="7">Seçilen dönemde kayıt yok.</td></tr>';
    const max=Math.max(1,...days.flatMap(day=>[day.deposit,day.withdrawal]));
    barsEl.innerHTML=days.map(day=>{
      const deposit=Math.max(day.deposit?2:0,day.deposit/max*190),withdrawal=Math.max(day.withdrawal?2:0,day.withdrawal/max*190),commission=Math.max(day.commission?2:0,day.commission/max*190);
      return `<div class="bar-group" title="${fmtDate(day.date)} · yatırım ${money(day.deposit)} · çekim ${money(day.withdrawal)} · komisyon ${data.commissionEnabled?money(day.commission):'—'}"><div class="bar-value">${money(day.deposit+day.withdrawal)}</div><div class="bar-stack"><div class="bar deposit" style="height:${deposit}px"></div><div class="bar withdraw" style="height:${withdrawal}px"></div><div class="bar commission" style="height:${commission}px"></div></div><div class="bar-label">${new Date(day.date+'T00:00:00Z').toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',timeZone:'UTC'})}</div></div>`;
    }).join('');
  }
  async function refresh(){
    let startDate=startEl.value,endDate=endEl.value;
    if(!startDate||!endDate)return;
    if(startDate>endDate){[startDate,endDate]=[endDate,startDate];startEl.value=startDate;endEl.value=endDate;}
    const params=new URLSearchParams({startDate,endDate});if(testRunId)params.set('testRunId',testRunId);
    try{render(await adminFetch('/finance/reconciliation?'+params.toString()));}
    catch(_){rowsEl.innerHTML='<tr><td class="empty-row" colspan="7">Mutabakat verileri alınamadı.</td></tr>';}
  }
  function setRange(value){
    const end=new Date(),start=new Date(end);
    if(value==='today')start.setHours(0,0,0,0);else if(value==='all')start.setFullYear(2020,0,1);else{start.setDate(start.getDate()-Number(value)+1);start.setHours(0,0,0,0);}
    startEl.value=dayKey(start);endEl.value=dayKey(end);
    document.querySelectorAll('[data-range]').forEach(button=>button.classList.toggle('active',button.dataset.range===String(value)));
    refresh();
  }
  el('applyBtn').onclick=refresh;
  document.querySelectorAll('[data-range]').forEach(button=>button.onclick=()=>setRange(button.dataset.range));
  const today=new Date();endEl.value=dayKey(today);const start=new Date(today);start.setDate(start.getDate()-89);startEl.value=dayKey(start);
  refresh();
})();
