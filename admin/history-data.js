let historyTransactions = [];
let historyUsers = new Map();
let typeFilter = new URLSearchParams(location.search).get('type') || 'deposit';
let statusFilter = new URLSearchParams(location.search).get('status') || 'approved';
const requestedUser = new URLSearchParams(location.search).get('user') || '';
const historyTestRunId = new URLSearchParams(location.search).get('testRunId') || '';
const historyPageSize = 40;
let historyPage = 1;
let historyLoadInFlight = false;
const historyById = id => historyTransactions.find(x => String(x.id) === String(id));
const historyMoney = n => Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 8 }) + ' USDT';
const historyDate = value => value ? new Date(value).toLocaleString('tr-TR') : '—';
const historyEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function historyStatus(status) {
  if (status === 'approved') return '<span class="status s-approved">Onaylandı</span>';
  if (status === 'auto-rejected') return '<span class="status s-auto">Süre doldu</span>';
  return '<span class="status s-rejected">Reddedildi</span>';
}
function historyStats() {
  document.getElementById('approvedCount').textContent = historyTransactions.filter(x => x.status === 'approved').length;
  document.getElementById('rejectedCount').textContent = historyTransactions.filter(x => ['rejected','auto-rejected'].includes(x.status)).length;
  document.getElementById('autoCount').textContent = historyTransactions.filter(x => x.status === 'auto-rejected').length;
  document.getElementById('depositTotal').textContent = historyTransactions.filter(x => x.type === 'deposit').length;
  document.getElementById('withdrawalTotal').textContent = historyTransactions.filter(x => x.type === 'withdrawal').length;
}
async function copyHistoryInfo(id) {
  const tx = historyById(id); if (!tx) return;
  const user = historyUsers.get(String(tx.userId)) || {};
  return window.copySupportTransactionDetails?.(tx,user,window.SafeAdmin?.current?.()||{});
}
async function reopenHistoryTransaction(id) {
  const tx=historyById(id); if(!tx || !['rejected','auto-rejected'].includes(tx.status)) return;
  if(!confirm(id+' işlemini yeniden inceleme sırasına almak istiyor musunuz?')) return;
  try { await adminFetch('/transactions/reopen',{method:'POST',body:JSON.stringify({transactionId:id})}); location.href='requests.html?type='+encodeURIComponent(tx.type)+'&open='+encodeURIComponent(id)+(historyTestRunId?'&testRunId='+encodeURIComponent(historyTestRunId):''); }
  catch(e) { alert(e.message||'İşlem yeniden açılamadı.'); }
}
function renderHistory() {
  const query=(document.getElementById('search').value||'').toLocaleLowerCase('tr-TR').trim();
  const network=document.getElementById('network').value;
  const filtered=historyTransactions.filter(x => x.type===typeFilter && (statusFilter==='all' ? x.status!=='pending' : statusFilter==='approved' ? x.status==='approved' : ['rejected','auto-rejected'].includes(x.status)) && (network==='all'||x.network===network) && [x.id,x.userId,x.txHash,x.address,historyUsers.get(String(x.userId))?.email,historyUsers.get(String(x.userId))?.firstName,historyUsers.get(String(x.userId))?.lastName].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR').includes(query)).sort((a,b)=>new Date(b.decisionAt||b.createdAt)-new Date(a.decisionAt||a.createdAt));
  const pageCount=Math.max(1,Math.ceil(filtered.length/historyPageSize));historyPage=Math.min(Math.max(1,historyPage),pageCount);
  const first=(historyPage-1)*historyPageSize,last=Math.min(filtered.length,first+historyPageSize),pageRows=filtered.slice(first,last);
  document.getElementById('rows').innerHTML=filtered.length?pageRows.map(x=>{const u=historyUsers.get(String(x.userId))||{};const user=[u.firstName,u.lastName].filter(Boolean).join(' ')||u.email||x.userId;return `<tr><td><span class="txid">${historyEsc(x.id)}</span>${x.isTestData?'<small class="synthetic-test-chip">TEST</small>':''}</td><td><b>${historyEsc(user)}</b><br><span class="sub">${historyEsc(x.userId)}</span></td><td>—</td><td>${x.type==='deposit'?'Yatırım':'Çekim'}</td><td><span class="amount ${x.type==='deposit'?'amount-deposit':'amount-withdrawal'}">${historyMoney(x.amount)}</span></td><td><span class="network ${x.network==='TRC20'?'trc':'erc'}">${historyEsc(x.network||'—')}</span></td><td><span class="sub">${historyEsc(x.txHash||x.address||'—')}</span></td><td>${historyDate(x.createdAt)}</td><td>${historyDate(x.decisionAt)}</td><td>${historyStatus(x.status)}</td><td style="white-space:nowrap"><a class="mini" href="requests.html?type=${encodeURIComponent(x.type)}&open=${encodeURIComponent(x.id)}${historyTestRunId?'&testRunId='+encodeURIComponent(historyTestRunId):''}">İncele</a> <button class="copy-info" type="button" onclick="copyHistoryInfo('${historyEsc(x.id)}')">Kopyala</button> ${['rejected','auto-rejected'].includes(x.status)?`<button class="requeue-btn" onclick="reopenHistoryTransaction('${historyEsc(x.id)}')">Yeniden incele</button>`:''}</td></tr>`;}).join(''):'<tr><td colspan="11" class="empty">Bu filtreye uygun kayıt bulunamadı.</td></tr>';
  const total=filtered.reduce((sum,x)=>sum+Number(x.amount||0),0);
  document.getElementById('totalCount').textContent=filtered.length;
  document.getElementById('totalLine').textContent=`Gösterilen ${filtered.length} işlem · ${historyMoney(total)} toplam tutar`;
  const pager=document.getElementById('historyPager');
  if(pager){pager.innerHTML='<span>'+(filtered.length?`${first+1}–${last} / ${filtered.length} kayıt`:'0 kayıt')+'</span><div class="requests-pagination__controls"><button type="button" data-history-delta="-1" '+(historyPage<=1?'disabled':'')+'>Önceki</button><span class="requests-pagination__page">'+historyPage+' / '+pageCount+'</span><button type="button" data-history-delta="1" '+(historyPage>=pageCount?'disabled':'')+'>Sonraki</button></div>';pager.querySelectorAll('[data-history-delta]').forEach(button=>button.addEventListener('click',()=>{historyPage+=Number(button.dataset.historyDelta);renderHistory();}));}
  document.querySelectorAll('.type-tab').forEach(button=>button.classList.toggle('active',button.dataset.type===typeFilter));
  document.querySelectorAll('.filter-btn').forEach(button=>button.classList.toggle('active',button.dataset.status===statusFilter));
}
async function loadHistory() {
  if(historyLoadInFlight)return;historyLoadInFlight=true;
  try {
    const [txData,userData]=await Promise.all([adminFetch('/transactions'),adminFetch('/users')]);
    historyTransactions=(txData.transactions||[]).filter(x=>x.status!=='pending');
    historyUsers=new Map((userData.users||[]).map(x=>[String(x.id),x]));
    historyStats();renderHistory();
  } catch(e) { document.getElementById('rows').innerHTML=`<tr><td colspan="11" class="empty">Kayıtlar alınamadı: ${historyEsc(e.message)}</td></tr>`; }
  finally { historyLoadInFlight=false; }
}
document.querySelectorAll('.type-tab').forEach(button=>button.addEventListener('click',()=>{typeFilter=button.dataset.type;historyPage=1;renderHistory();}));
document.querySelectorAll('.filter-btn').forEach(button=>button.addEventListener('click',()=>{statusFilter=button.dataset.status;historyPage=1;renderHistory();}));
document.getElementById('search').addEventListener('input',()=>{historyPage=1;renderHistory();});
document.getElementById('network').addEventListener('change',()=>{historyPage=1;renderHistory();});
if(requestedUser)document.getElementById('search').value=requestedUser;
loadHistory();
setInterval(loadHistory,historyTestRunId?30000:15000);
