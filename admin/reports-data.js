(function(){
  const el=id=>document.getElementById(id);
  const money=value=>Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' USDT';
  const pad=value=>String(value).padStart(2,'0');
  const dayKey=date=>date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
  function localDate(date){return new Date(date.getFullYear(),date.getMonth(),date.getDate());}
  function updateChart(rows){
    const bars=el('reportBars');if(!bars)return;
    const max=Math.max(1,...rows.flatMap(day=>[day.deposit,day.withdrawal]));
    bars.innerHTML=rows.map(day=>{
      const dep=Math.max(day.deposit?2:0,day.deposit/max*190),wd=Math.max(day.withdrawal?2:0,day.withdrawal/max*190),commission=Math.max(day.commission?2:0,day.commission/max*190);
      const label=new Date(day.date+'T00:00:00Z').toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
      return `<div class="report-bar-group" title="${label}: yatırım ${money(day.deposit)} · çekim ${money(day.withdrawal)} · komisyon ${money(day.commission)}"><div class="report-bar-stack"><i class="deposit" style="height:${dep}px"></i><i class="withdrawal" style="height:${wd}px"></i><i class="commission" style="height:${commission}px"></i></div><small>${label}</small></div>`;
    }).join('');
  }
  function updateTable(rows,commissionEnabled){
    const body=el('reportRows');if(!body)return;
    body.innerHTML=rows.length?rows.map(day=>`<tr><td>${new Date(day.date+'T00:00:00Z').toLocaleDateString('tr-TR',{timeZone:'UTC'})}</td><td>${money(day.deposit)}</td><td>${money(day.withdrawal)}</td><td>${commissionEnabled?money(day.commission):'—'}</td><td>${money(day.cash)}</td><td>${day.count}</td></tr>`).join(''):'<tr><td colspan="6">Seçilen dönemde kayıt yok.</td></tr>';
  }
  async function refreshReports(){
    const range=Number(el('range')?.value||90),end=localDate(new Date()),start=new Date(end);start.setDate(start.getDate()-range+1);
    const params=new URLSearchParams({startDate:dayKey(start),endDate:dayKey(end)}),testRunId=new URLSearchParams(location.search).get('testRunId');
    if(testRunId)params.set('testRunId',testRunId);
    try{
      const data=await adminFetch('/finance/reconciliation?'+params.toString()),totals=data.totals||{},rows=data.days||[];
      el('dep').textContent=money(totals.deposit);el('wd').textContent=money(totals.withdrawal);el('commission').textContent=data.commissionEnabled?money(totals.commission):'Etkin değil';
      el('cash').textContent=money(totals.cash);el('cnt').textContent=String(totals.count||0);el('pend').textContent=String(totals.pendingCount||0);
      const note=el('reportNote');if(note)note.textContent=data.commissionEnabled?'Onaylı yatırımlar üzerinden %3 hesaplanır.':'Komisyon modeli etkin değil.';
      updateChart(rows);updateTable(rows,data.commissionEnabled);
    }catch(_){for(const id of ['dep','wd','commission','cash','cnt','pend'])if(el(id))el(id).textContent='Veri alınamadı';const body=el('reportRows');if(body)body.innerHTML='<tr><td colspan="6">Rapor verileri alınamadı.</td></tr>';}
  }
  el('range')?.addEventListener('change',refreshReports);
  refreshReports();
})();
