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
async function loadDashboardData(){
  const authToken=token();if(!authToken){location.replace('login.html');return;}
  try{
    const headers={Authorization:'Bearer '+authToken},[userResponse,txResponse]=await Promise.all([fetch('/api/auth/me',{headers,cache:'no-store'}),fetch('/api/transactions',{headers,cache:'no-store'})]);
    if(userResponse.status===401||txResponse.status===401)throw new Error('unauthorized');if(!userResponse.ok||!txResponse.ok)throw new Error('Sunucu verileri alınamadı.');
    const userData=await userResponse.json(),txData=await txResponse.json(),user=userData.user||{},transactions=txData.transactions||[];
    const name=[user.firstName,user.lastName].filter(Boolean).join(' ')||user.username||'Kullanıcı';const welcome=document.getElementById('welcomeName');if(welcome)welcome.textContent='Hoş Geldiniz, '+name;
    renderDashboardBalance(Number(user.balance||0));renderDashboardTransactions(transactions);renderDashboardChart(transactions);
    const referral=document.getElementById('dashboardReferralCode');if(referral)referral.textContent=user.referralCode||'—';
    const copy=document.getElementById('dashboardReferralCopy');if(copy)copy.onclick=()=>window.copyText?.(user.referralCode||'');
    document.querySelectorAll('.avatar-sm').forEach(el=>el.textContent=name.split(/\s+/).map(x=>x[0]||'').slice(0,2).join('').toUpperCase()||'SP');
  }catch(error){if(error.message==='unauthorized'){localStorage.removeItem('safepays_api_token');localStorage.removeItem('safepays_current_user');location.replace('login.html');return;}const el=document.getElementById('dashboardBalanceMeta');if(el)el.textContent='Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.';}
}
document.addEventListener('DOMContentLoaded',loadDashboardData,{once:true});
