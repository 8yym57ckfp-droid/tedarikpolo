const auditEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const auditDate=value=>value?new Date(value).toLocaleString('tr-TR'):'—';
const auditMoney=value=>Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:8})+' USDT';
let auditRows=[],decisionRows=[];
function renderAudit(){
  const q=(document.getElementById('auditSearch').value||'').toLocaleLowerCase('tr-TR').trim(),status=document.getElementById('auditStatus').value;
  const visible=auditRows.filter(x=>(status==='all'||x.status===status)&&JSON.stringify(x).toLocaleLowerCase('tr-TR').includes(q));
  document.getElementById('auditTotal').textContent=String(auditRows.length);
  document.getElementById('auditSuccess').textContent=String(auditRows.filter(x=>x.status==='success').length);
  document.getElementById('auditFailed').textContent=String(auditRows.filter(x=>x.status==='failed').length);
  document.getElementById('auditLast').textContent=auditRows[0]?auditDate(auditRows[0].createdAt):'—';
  document.getElementById('auditRows').innerHTML=visible.length?visible.map(x=>`<tr><td><span class="audit-badge ${x.status==='success'?'success':'info'}">${x.status==='success'?'Başarılı':'Kayıt'}</span></td><td><b>${auditEsc(x.actor||'Sistem')}</b><small>${auditEsc(x.action||'')}</small></td><td>Yönetici / sistem</td><td>${auditEsc(auditDate(x.createdAt))}</td><td class="mono">${auditEsc(x.meta?.ip||'—')}</td><td>${auditEsc(x.meta?.device||'—')}</td><td>—</td><td>${auditEsc(x.meta?.browser||'—')}</td></tr>`).join(''):'<tr><td colspan="8" class="audit-empty">Kayıt bulunamadı.</td></tr>';
  document.getElementById('transactionAuditRows').innerHTML=decisionRows.length?decisionRows.map(x=>{const m=x.meta||{},approved=m.decision==='approved';return `<tr><td><span class="audit-badge ${approved?'success':'failed'}">${approved?'Onaylandı':'Reddedildi'}</span></td><td class="mono">${auditEsc(m.transactionId||'—')}</td><td>—<small>${auditEsc(m.userId||'')}</small></td><td>${auditEsc(auditMoney(m.requestedAmount))}</td><td>${auditEsc(auditMoney(m.approvedAmount))}</td><td>${m.amountChanged?'Değiştirildi':'Aynı'}</td><td>${auditEsc(x.actor||'—')}</td><td>${auditEsc(auditDate(x.createdAt))}</td></tr>`;}).join(''):'<tr><td colspan="8" class="audit-empty">Henüz işlem kararı kaydı yok.</td></tr>';
}
async function refreshAudit(){
  try{const data=await adminFetch('/audit');auditRows=(data.audit||[]).map(x=>({...x,status:String(x.action||'').includes('failed')?'failed':String(x.action||'').includes('login')?'success':'info'})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));decisionRows=auditRows.filter(x=>x.action==='transaction_decision');renderAudit();}
  catch(e){document.getElementById('auditRows').innerHTML=`<tr><td colspan="8" class="audit-empty">Kayıtlar alınamadı: ${auditEsc(e.message)}</td></tr>`;}
}
document.getElementById('auditSearch').addEventListener('input',renderAudit);
document.getElementById('auditStatus').addEventListener('change',renderAudit);
document.getElementById('auditRefresh').addEventListener('click',refreshAudit);
refreshAudit();
