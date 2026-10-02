(()=>{
  const byId=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value||0).toLocaleString('tr-TR');
  const amount=value=>Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:4})+' USDT';
  const statusLabel={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi'};
  async function loadTeamOverview(){
    const rows=byId('recentRows');
    try{
      const [stats,data]=await Promise.all([adminFetch('/stats'),adminFetch('/transactions')]);
      const tx=Array.isArray(data.transactions)?data.transactions:[];
      const pending=tx.filter(x=>x.status==='pending');
      byId('userCount').textContent=number(stats.users);
      byId('pendingCount').textContent=number(stats.pending);
      byId('pendingNote').textContent=`${pending.filter(x=>x.type==='deposit').length} yatırım · ${pending.filter(x=>x.type==='withdrawal').length} çekim`;
      byId('approvedCount').textContent=number(stats.approved);
      byId('kycCount').textContent=number(stats.kycPending);
      const recent=tx.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,8);
      rows.innerHTML=recent.map(x=>{
        const type=x.type==='deposit'?'Yatırım':x.type==='withdrawal'?'Çekim':x.type||'—';
        const status=statusLabel[x.status]||escapeHtml(x.status||'—');
        const date=x.createdAt?new Date(x.createdAt).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}):'—';
        return `<tr><td><a href="requests.html?open=${encodeURIComponent(x.id||'')}" class="overview-link">${escapeHtml(String(x.id||'—').slice(0,14))}</a></td><td>${escapeHtml(type)}</td><td>${escapeHtml(x.network||'—')}</td><td><b>${amount(x.amount)}</b></td><td><span class="overview-status ${escapeHtml(x.status||'')}">${status}</span></td><td>${escapeHtml(date)}</td></tr>`;
      }).join('')||'<tr><td class="overview-empty" colspan="6">Henüz işlem kaydı yok.</td></tr>';
      byId('updatedAt').textContent='Son güncelleme: '+new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    }catch(_){
      rows.innerHTML='<tr><td class="overview-empty" colspan="6">Sunucu bilgileri alınamadı. Oturumu yenileyip tekrar dene.</td></tr>';
      byId('updatedAt').textContent='Bilgiler alınamadı';
    }
  }
  byId('refreshOverview')?.addEventListener('click',loadTeamOverview);
  loadTeamOverview();
  setInterval(loadTeamOverview,30000);
})();
