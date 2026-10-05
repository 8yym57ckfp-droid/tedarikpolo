(()=>{
  const byId=id=>document.getElementById(id);
  if(!byId('financeOverview'))return;
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const compact=value=>Number(value||0).toLocaleString('tr-TR',{notation:'compact',maximumFractionDigits:1});
  const amount=value=>money(value)+' USDT';
  const dateKey=date=>date.toISOString().slice(0,10);
  const owner=location.pathname.includes('/owner/');
  const statusText={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi','auto-rejected':'Reddedildi'};
  let transactionCache=[],memberCache=new Map(),supportTeam={};

  function makeRange(){
    const end=new Date();end.setUTCHours(0,0,0,0);
    const start=new Date(end.getTime()-6*86400000);
    return {startDate:dateKey(start),endDate:dateKey(end)};
  }
  function renderChart(days,commissionEnabled){
    const svg=byId('financeTrend');if(!svg)return;
    const width=760,height=225,left=48,right=12,top=14,bottom=31;
    const keys=commissionEnabled?['deposit','withdrawal','commission']:['deposit','withdrawal'];
    const max=Math.max(1,...days.flatMap(day=>keys.map(key=>Number(day[key]||0))))*1.12;
    const x=index=>left+index*(width-left-right)/Math.max(1,days.length-1);
    const y=value=>top+(height-top-bottom)*(1-Number(value||0)/max);
    let content='';
    for(let row=0;row<=4;row++){
      const yy=top+row*(height-top-bottom)/4;
      content+=`<line class="gridline" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text x="2" y="${yy+3}">${compact(max*(1-row/4))}</text>`;
    }
    const lineClass={deposit:'deposit-line',withdrawal:'withdraw-line',commission:'commission-line'};
    const pointClass={deposit:'deposit-point',withdrawal:'withdraw-point',commission:'commission-point'};
    for(const key of keys){
      const points=days.map((day,index)=>`${x(index)},${y(day[key])}`).join(' ');
      content+=`<polyline class="${lineClass[key]}" points="${points}"/>`;
      days.forEach((day,index)=>{content+=`<circle class="${pointClass[key]}" cx="${x(index)}" cy="${y(day[key])}" r="3.5"/>`;});
    }
    days.forEach((day,index)=>{
      const label=new Date(day.date+'T00:00:00Z').toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
      content+=`<text x="${x(index)}" y="${height-7}" text-anchor="middle">${label}</text>`;
    });
    svg.innerHTML=content;
  }
  function renderDonut(totals,commissionEnabled){
    const donut=byId('financeDonut');
    const values=[Math.max(0,Number(totals.deposit||0)),Math.max(0,Number(totals.withdrawal||0))];
    if(commissionEnabled)values.push(Math.max(0,Number(totals.commission||0)));
    const total=values.reduce((sum,value)=>sum+value,0);
    const depositDegrees=total?values[0]/total*360:0;
    const withdrawalDegrees=total?(values[0]+values[1])/total*360:0;
    if(donut)donut.style.background=total?`conic-gradient(#178bff 0deg ${depositDegrees}deg,#34d399 ${depositDegrees}deg ${withdrawalDegrees}deg${commissionEnabled?`,#42b8ff ${withdrawalDegrees}deg 360deg`:''})`:'conic-gradient(#1d3550 0deg 360deg)';
    byId('financeDonutTotal').textContent=amount(total);
    byId('financeDepositPct').textContent=`%${total?(values[0]/total*100).toFixed(1):'0,0'}`;
    byId('financeWithdrawalPct').textContent=`%${total?(values[1]/total*100).toFixed(1):'0,0'}`;
    const commissionRow=byId('financeCommissionLegend');
    commissionRow.hidden=!commissionEnabled;
    byId('financeCommissionChartLegend').hidden=!commissionEnabled;
    if(commissionEnabled)byId('financeCommissionPct').textContent=`%${total?(values[2]/total*100).toFixed(1):'0,0'}`;
  }
  function renderTables(transactions,range){
    const inPeriod=transactions.filter(tx=>tx.status==='approved'&&String(tx.decisionAt||tx.approvedAt||tx.createdAt||'').slice(0,10)>=range.startDate&&String(tx.decisionAt||tx.approvedAt||tx.createdAt||'').slice(0,10)<=range.endDate);
    const sorted=(type)=>inPeriod.filter(tx=>tx.type===type).sort((a,b)=>new Date(b.decisionAt||b.approvedAt||b.createdAt||0)-new Date(a.decisionAt||a.approvedAt||a.createdAt||0)).slice(0,5);
    for(const [type,id] of [['deposit','financeDepositRows'],['withdrawal','financeWithdrawalRows']]){
      const rows=byId(id);if(!rows)continue;
      const items=sorted(type);
      rows.innerHTML=items.map(tx=>{
        const timestamp=tx.decisionAt||tx.approvedAt||tx.createdAt;
        const date=timestamp?new Date(timestamp).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}):'—';
        const color=type==='deposit'?'deposit':'withdraw';
        return `<tr><td><strong>#${escapeHtml(String(tx.id||'—').slice(0,16))}</strong></td><td class="finance-table-amount ${color}">${amount(tx.amount)}</td><td>${escapeHtml(tx.network||'—')}</td><td>${escapeHtml(date)}</td><td><span class="finance-table-status">${statusText[tx.status]||'Onaylandı'}</span></td><td><button class="finance-copy-transaction" type="button" onclick="copyFinanceSupportTransaction('${escapeHtml(tx.id)}')">Kopyala</button></td></tr>`;
      }).join('')||'<tr><td class="finance-empty" colspan="6">Seçilen dönemde onaylı kayıt yok.</td></tr>';
    }
  }
  async function load(){
    const range=makeRange();
    const params=new URLSearchParams(range);
    const runId=owner?new URLSearchParams(location.search).get('testRunId'):null;
    if(runId)params.set('testRunId',runId);
    try{
      const [finance,transactionData,userData,profileData]=await Promise.all([
        adminFetch('/finance/reconciliation?'+params.toString()),
        adminFetch('/transactions'),
        adminFetch('/users').catch(()=>({users:[]})),
        adminFetch('/me').catch(()=>({}))
      ]);
      transactionCache=Array.isArray(transactionData.transactions)?transactionData.transactions:[];
      memberCache=new Map((userData.users||[]).map(user=>[String(user.id),user]));
      supportTeam=profileData.admin||profileData.owner||window.SafeAdmin?.current?.()||{};
      window.copyFinanceSupportTransaction=id=>{const tx=transactionCache.find(item=>String(item.id)===String(id));if(tx)return window.copySupportTransactionDetails?.(tx,memberCache.get(String(tx.userId))||{},supportTeam);};
      const days=Array.isArray(finance.days)?finance.days:[];
      const totals=finance.totals||{};
      const commissionEnabled=!!finance.commissionEnabled;
      const today=days.find(day=>day.date===range.endDate)||{};
      byId('financeDeposits').textContent=amount(totals.deposit);
      byId('financeWithdrawals').textContent=amount(totals.withdrawal);
      byId('financeCommissions').textContent=commissionEnabled?amount(totals.commission):'—';
      byId('financeReceivable').textContent=commissionEnabled?amount(totals.receivable):'—';
      const commissionPercent=Number(finance.commissionPercent??Number(finance.commissionRate||0)*100);
      byId('financeCommissionNote').textContent=commissionEnabled?`Bugün ${amount(today.commission)} · ekip oranı %${commissionPercent.toLocaleString('tr-TR')}`:'Bu hesapta komisyon mutabakatı etkin değil.';
      byId('financeReceivableNote').textContent=commissionEnabled?`Bugün ${amount(today.receivable)} net alacak`:'Komisyon modeli tanımlandığında hesaplanır.';
      byId('financeDepositsNote').textContent=`Bugün ${amount(today.deposit)}`;
      byId('financeWithdrawalsNote').textContent=`Bugün ${amount(today.withdrawal)}`;
      renderChart(days,commissionEnabled);
      renderDonut(totals,commissionEnabled);
      renderTables(transactionCache,range);
      byId('financePeriod').textContent=`${new Date(range.startDate+'T00:00:00Z').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',timeZone:'UTC'})} – ${new Date(range.endDate+'T00:00:00Z').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',timeZone:'UTC'})}`;
      byId('financeUpdated').textContent='Son güncelleme: '+new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
      byId('financeError').hidden=true;
    }catch(_){
      byId('financeError').hidden=false;
      byId('financeUpdated').textContent='Finansal özet alınamadı';
    }
  }
  byId('financeRefresh')?.addEventListener('click',load);
  load();
  setInterval(load,30000);
})();
