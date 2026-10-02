const token=()=>localStorage.getItem('safepays_api_token')||'';
const fmt=n=>Number(n||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderDashboardBalance(balance){
  const text=fmt(balance)+' USDT';
  ['headerBalance','headerBalanceStrong','dashboardBalance','assetBalance'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=text;});
  const value=document.getElementById('assetBalanceValue');if(value)value.textContent=fmt(balance);
  const meta=document.getElementById('dashboardBalanceMeta');if(meta)meta.textContent='USDT hesabınızdaki güncel bakiye';
}
function renderDashboardTransactions(rows){
  const tbody=document.getElementById('dashboardTxRows');if(!tbody)return;
  const status={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi','auto-rejected':'Süresi doldu'};
  tbody.innerHTML=rows.slice(0,6).map(x=>`<tr><td>${x.type==='deposit'?'Yatırım':'Çekim'}</td><td>${fmt(x.amount)} USDT</td><td>${esc(x.network||'—')}</td><td>${esc(status[x.status]||x.status)}</td><td>${new Date(x.createdAt).toLocaleDateString('tr-TR')}</td></tr>`).join('')||'<tr><td colspan="5">Henüz işlem bulunmuyor.</td></tr>';
  const recent=document.getElementById('dashboardRecent');if(recent){recent.innerHTML=rows.slice(0,3).map(x=>`<div class="recent-row"><div class="recent-copy"><strong>${x.type==='deposit'?'Yatırım':'Çekim'} · ${fmt(x.amount)} USDT</strong><span>${esc(status[x.status]||x.status)} · ${new Date(x.createdAt).toLocaleString('tr-TR')}</span></div></div>`).join('')||'<div class="recent-row"><div class="recent-copy"><strong>Henüz işlem yok</strong><span>İşlemleriniz burada görünecek.</span></div></div>';}
}
function renderDashboardChart(rows){
  const chart=document.getElementById('dashboardChart');if(!chart)return;
  const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(6-i));return d;});
  const totals=days.map(day=>rows.filter(x=>x.status==='approved'&&new Date(x.createdAt).toDateString()===day.toDateString()).reduce((sum,x)=>sum+Number(x.amount||0),0));
  const max=Math.max(...totals,0);chart.innerHTML=totals.map((n,i)=>`<div class="bar ${i%2?'alt':''}" title="${days[i].toLocaleDateString('tr-TR')}: ${fmt(n)} USDT" style="height:${max?Math.max(5,n/max*100):5}%"></div>`).join('');
  const labels=document.querySelector('.chart-labels');if(labels)labels.innerHTML=days.map(day=>`<span>${day.toLocaleDateString('tr-TR',{weekday:'short'})}</span>`).join('');
}
function renderNetworkSparkline(rows,now){
  const incoming=Array(24).fill(0),outgoing=Array(24).fill(0),since=now.getTime()-24*60*60*1000;
  rows.forEach(row=>{
    const time=new Date(row.createdAt).getTime();if(!Number.isFinite(time)||time<since||time>now.getTime()||row.status!=='approved')return;
    const bucket=Math.min(23,Math.floor((time-since)/(60*60*1000))),amount=Number(row.amount||0);if(!Number.isFinite(amount)||amount<0)return;
    if(row.type==='deposit')incoming[bucket]+=amount;else if(row.type==='withdrawal')outgoing[bucket]+=amount;
  });
  const max=Math.max(0,...incoming,...outgoing);
  const path=values=>values.map((value,index)=>`${index?'L':'M'}${(index*320/23).toFixed(1)} ${(65-(max?value/max*47:0)).toFixed(1)}`).join(' ');
  return `<svg class="network-live-chart" viewBox="0 0 320 76" preserveAspectRatio="none" role="img" aria-label="Son 24 saatteki onaylı yatırımlar ve çekimler"><path class="network-chart-grid" d="M0 18H320M0 41H320M0 64H320"/><path class="network-chart-in" d="${path(incoming)}"/><path class="network-chart-out" d="${path(outgoing)}"/></svg>`;
}
function renderDashboardNetworks(rows){
  const grid=document.getElementById('networkFlowGrid'),stamp=document.getElementById('networkLiveUpdated');if(!grid)return;
  const now=new Date(),since=now.getTime()-24*60*60*1000,status={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi','auto-rejected':'Süresi doldu'};
  grid.innerHTML=['TRC20','ERC20'].map(network=>{
    const all=rows.filter(row=>String(row.network||'').toUpperCase()===network),recent=all.filter(row=>{const date=new Date(row.createdAt).getTime();return Number.isFinite(date)&&date>=since&&date<=now.getTime();}).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const approved=recent.filter(row=>row.status==='approved'),deposits=approved.filter(row=>row.type==='deposit').reduce((sum,row)=>sum+Number(row.amount||0),0),withdrawals=approved.filter(row=>row.type==='withdrawal').reduce((sum,row)=>sum+Number(row.amount||0),0);
    const label=network==='TRC20'?'TRON':'Ethereum';
    const activity=recent.slice(0,3).map(row=>{
      const date=new Date(row.createdAt),type=row.type==='deposit'?'Yatırım':'Çekim',state=status[row.status]||row.status||'Durum bilinmiyor';
      return `<li><span class="network-live-kind">${type}</span><span class="network-live-amount">${fmt(row.amount)} USDT</span><span class="network-live-state">${esc(state)} · ${Number.isFinite(date.getTime())?date.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}):'—'}</span></li>`;
    }).join('')||'<li class="network-live-empty">Son 24 saatte bu ağda hareket yok.</li>';
    return `<article class="network-live-card"><div class="network-live-card-head"><div class="network-live-name"><span class="network-live-symbol" aria-hidden="true">${network==='TRC20'?'T':'Ξ'}</span><span><strong>${network}</strong><small>${label} ağı · Hesap hareketleri</small></span></div><span class="network-live-count">${recent.length} kayıt</span></div><div class="network-live-metrics"><div><span>Onaylı yatırım</span><strong>${fmt(deposits)} <small>USDT</small></strong></div><div><span>Onaylı çekim</span><strong>${fmt(withdrawals)} <small>USDT</small></strong></div></div><div class="network-live-chart-wrap">${renderNetworkSparkline(all,now)}<div class="network-live-legend"><span><i class="in"></i>Yatırım</span><span><i class="out"></i>Çekim</span><small>Son 24 saat</small></div></div><ul class="network-live-list">${activity}</ul></article>`;
  }).join('');
  if(stamp){stamp.innerHTML='<i></i><span>Hesap verisi · '+now.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+'</span>';}
}
let dashboardLoading=false;
async function loadDashboardData(){
  if(dashboardLoading)return;dashboardLoading=true;
  const authToken=token();if(!authToken){dashboardLoading=false;location.replace('login.html');return;}
  try{
    const headers={Authorization:'Bearer '+authToken},[userResponse,txResponse]=await Promise.all([fetch('/api/auth/me',{headers,cache:'no-store'}),fetch('/api/transactions',{headers,cache:'no-store'})]);
    if(userResponse.status===401||txResponse.status===401)throw new Error('unauthorized');if(!userResponse.ok||!txResponse.ok)throw new Error('Sunucu verileri alınamadı.');
    const userData=await userResponse.json(),txData=await txResponse.json(),user=userData.user||{},transactions=txData.transactions||[];
    const name=[user.firstName,user.lastName].filter(Boolean).join(' ')||user.username||'Kullanıcı';const welcome=document.getElementById('welcomeName');if(welcome)welcome.textContent='Hoş Geldiniz, '+name;
    renderDashboardBalance(Number(user.balance||0));renderDashboardTransactions(transactions);renderDashboardChart(transactions);renderDashboardNetworks(transactions);
    const referral=document.getElementById('dashboardReferralCode');if(referral)referral.textContent=user.referralCode||'—';
    const copy=document.getElementById('dashboardReferralCopy');if(copy)copy.onclick=()=>window.copyText?.(user.referralCode||'');
    document.querySelectorAll('.avatar-sm').forEach(el=>el.textContent=name.split(/\s+/).map(x=>x[0]||'').slice(0,2).join('').toUpperCase()||'SP');
  }catch(error){if(error.message==='unauthorized'){localStorage.removeItem('safepays_api_token');localStorage.removeItem('safepays_current_user');location.replace('login.html');return;}const el=document.getElementById('dashboardBalanceMeta');if(el)el.textContent='Sunucu verisi alınamadı; son görünen kayıtlar korunuyor.';const stamp=document.getElementById('networkLiveUpdated');if(stamp)stamp.innerHTML='<i class="offline"></i><span>Sunucu bağlantısı bekleniyor</span>';const grid=document.getElementById('networkFlowGrid');if(grid?.querySelector('.network-live-loading'))grid.innerHTML='<div class="network-live-loading">Hesap ağ hareketi şu anda alınamadı. Bağlantı kurulduğunda tekrar yüklenecek.</div>';}
  finally{dashboardLoading=false;}
}
document.addEventListener('DOMContentLoaded',()=>{loadDashboardData();window.setInterval(()=>{if(document.visibilityState==='visible')loadDashboardData();},30000);},{once:true});
