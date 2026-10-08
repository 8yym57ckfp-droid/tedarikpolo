(function(){
  const el=id=>document.getElementById(id),team=el('targetTeam'),status=el('seedStatus'),button=el('seedButton'),links=el('resultLinks'),runs=el('testRuns');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function show(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
  function updateConfirm(){const chosen=team.selectedOptions[0];el('confirmedEmail').value=chosen?.dataset.email||'';el('confirmText').value='';el('confirmText').placeholder=chosen?.value?`TEST ${chosen.value}`:'TEST ekip-numarası';links.hidden=true;links.replaceChildren();}
  async function loadRuns(){
    try{
      const data=await adminFetch('/synthetic-finance/runs'),items=data.runs||[];
      runs.innerHTML=items.length?items.map(run=>`<tr><td><b>${esc(run.teamEmail||'Ekip bilgisi yok')}</b><small class="run-sub">${esc(run.id)}</small></td><td>${esc(run.startDate)} — ${esc(run.endDate)}</td><td>${Number(run.memberCount||0)}</td><td>${Number(run.transactionCount||0)}</td><td><button class="admin-btn dark delete-test-run" type="button" data-run="${esc(run.id)}">Test verisini sil</button></td></tr>`).join(''):'<tr><td colspan="5">Henüz test çalıştırması yok.</td></tr>';
      runs.querySelectorAll('[data-run]').forEach(row=>row.addEventListener('click',()=>deleteRun(row.dataset.run)));
    }catch(error){runs.innerHTML=`<tr><td colspan="5">Test çalıştırmaları alınamadı: ${esc(error.message)}</td></tr>`;}
  }
  async function loadTeams(){
    try{
      const [settings,data]=await Promise.all([adminFetch('/synthetic-finance/status'),adminFetch('/team-accounts')]);
      const accounts=(data.accounts||[]).filter(account=>/batman/i.test(String(account.email||'')));
      team.replaceChildren(new Option(accounts.length?'Batman ekip hesabı seçin':'Batman ekip hesabı bulunamadı',''));
      accounts.forEach(account=>{const option=new Option(`${account.email} · ${account.id}`,account.id);option.dataset.email=account.email;team.add(option);});
      const batman=accounts[0];
      if(batman){team.value=batman.id;updateConfirm();}
      button.disabled=!settings.enabled||!accounts.length;
      show(!settings.enabled?'Sunucuda SYNTHETIC_FINANCE_SEED_ENABLED=true ayarı kapalı.':batman?'Batman hesabı seçildi. Owner 2FA ile 90 günlük TEST geçmişi oluştur.':'Batman ekip hesabı bulunamadı; başka bir ekibe test verisi eklenmedi.',!batman);
    }catch(error){show(error.message||'Ekip hesapları alınamadı.',true);button.disabled=true;}
    await loadRuns();
  }
  async function deleteRun(runId){
    if(!window.confirm(`${runId} çalıştırmasına ait test üyelerini, işlemlerini ve test defter satırlarını kalıcı olarak silmek istiyor musunuz?`))return;
    const code=window.prompt('Owner 2FA kodunu girin:');if(code===null)return;
    try{await adminFetch('/synthetic-finance/runs/delete',{method:'POST',body:JSON.stringify({runId,confirmText:`SİL ${runId}`,totpCode:code.trim()})});show('Test çalıştırması ve ona bağlı test kayıtları silindi. Gerçek ekip bakiyesi ve kasa etkilenmedi.');await loadRuns();}
    catch(error){show(error.message||'Test çalıştırması silinemedi.',true);}
  }
  team.addEventListener('change',updateConfirm);
  el('seedForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const teamAccountId=team.value;if(!teamAccountId){show('Önce Batman ekip hesabını seçin.',true);return;}
    button.disabled=true;show('90 günlük test geçmişi hazırlanıyor…');links.hidden=true;
    try{
      const result=await adminFetch('/synthetic-finance/seed',{method:'POST',body:JSON.stringify({teamAccountId,confirmedEmail:el('confirmedEmail').value.trim(),confirmText:el('confirmText').value.trim(),totpCode:el('totpCode').value.trim()})});
      const run=result.run,runId=encodeURIComponent(run.id);
      show(`Tamamlandı. ${run.memberCount} TEST üyesi ve ${run.transactionCount} TEST talebi oluşturuldu. Tarih aralığı: ${run.startDate} – ${run.endDate}. Gerçek kasa, Batman teminatı ve gerçek üye bakiyeleri değişmedi.`);
      const items=[
        ['Ekip genel bakış','/admin/team-dashboard.html?testRunId='+runId],
        ['Ekip bekleyen yatırımlar','/admin/requests.html?type=deposit&testRunId='+runId],
        ['Ekip çekim havuzu','/admin/requests.html?type=withdrawal&testRunId='+runId],
        ['Ekip işlem geçmişi','/admin/history.html?status=approved&testRunId='+runId],
        ['Ekip raporları','/admin/reports.html?testRunId='+runId],
        ['Ekip mutabakatı','/admin/reconciliation.html?testRunId='+runId],
        ['Owner özeti','/owner/dashboard.html?testRunId='+runId],
        ['Owner işlem geçmişi','/owner/history.html?status=approved&testRunId='+runId],
        ['Owner raporları',result.reportUrl],
        ['Owner mutabakatı',result.reconciliationUrl]
      ];
      links.replaceChildren(...items.map(([label,href])=>{const a=document.createElement('a');a.textContent=label;a.href=href;return a;}));links.hidden=false;el('totpCode').value='';await loadRuns();
    }catch(error){show(error.message||'Test verisi oluşturulamadı.',true);button.disabled=false;}
  });
  loadTeams();
})();
