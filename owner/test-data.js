(function(){
  const el=id=>document.getElementById(id),target=el('targetUser'),status=el('seedStatus'),button=el('seedButton'),links=el('resultLinks');
  function show(message,error=false){status.textContent=message;status.classList.toggle('error',error);}
  function isMarked(){return target.selectedOptions[0]?.dataset.testAccount==='true';}
  function updateButton(){button.textContent=isMarked()?'90 günlük geçmiş oluştur':'Hesabı test hesabı olarak işaretle';}
  async function loadUsers(preferredId=''){
    try{
      const data=await adminFetch('/synthetic-finance/eligible-users');
      target.replaceChildren(new Option(data.users.length?'Test hesabı seçin':'Uygun boş test hesabı bulunamadı',''));
      data.users.forEach(user=>{const option=new Option(`${[user.firstName,user.lastName].filter(Boolean).join(' ')} · ${user.email} · ${user.id}${user.isTestAccount?' · test hesabı':' · işaretlenmeli'}`,user.id);option.dataset.testAccount=String(user.isTestAccount);target.add(option);});
      if(preferredId)target.value=preferredId;
      button.disabled=!data.enabled||!data.users.length;
      updateButton();
      show(data.enabled?'Seçilen hesabı önce test hesabı olarak kaydedin. Bu hesap üretim listeleri ve toplamlarından çıkarılır; ikinci onayla sentetik geçmiş eklenir.':'Sunucuda SYNTHETIC_FINANCE_SEED_ENABLED=true ayarı kapalı.');
    }catch(error){show(error.message||'Hesap listesi alınamadı.',true);button.disabled=true;}
  }
  target.addEventListener('change',()=>{
    const chosen=target.selectedOptions[0];updateButton();
    el('confirmedEmail').value='';
    el('confirmText').value='';
    el('confirmText').placeholder=chosen?.value?`TEST ${chosen.value}`:'TEST hesap-numarası';
    links.hidden=true;links.replaceChildren();
  });
  el('seedForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const targetUserId=target.value;
    if(!targetUserId){show('Önce uygun boş hesabı seçin.',true);return;}
    button.disabled=true;show(isMarked()?'90 günlük kayıtlar hazırlanıyor…':'Hesap test kullanıcısı olarak kaydediliyor…');links.hidden=true;
    try{
      const confirmation={
        targetUserId,
        confirmedEmail:el('confirmedEmail').value.trim(),
        confirmText:el('confirmText').value.trim(),
        totpCode:el('totpCode').value.trim()
      };
      if(!isMarked()){
        await adminFetch('/synthetic-finance/mark-test-user',{method:'POST',body:JSON.stringify(confirmation)});
        el('confirmedEmail').value='';el('confirmText').value='';
        el('totpCode').value='';await loadUsers(targetUserId);
        show('Hesap test hesabı olarak işaretlendi ve üretim listeleri/toplamlarından çıkarıldı. Geçmişi oluşturmak için e-posta ve onay ifadesini tekrar girip yeni Owner 2FA koduyla devam edin.');
        return;
      }
      const result=await adminFetch('/synthetic-finance/seed',{method:'POST',body:JSON.stringify(confirmation)});
      show(`Tamamlandı. ${result.run.memberCount} üye ve ${result.run.transactionCount} talep eklendi. Tarih aralığı: ${result.run.startDate} – ${result.run.endDate}.`);
      const runId=encodeURIComponent(result.run.id),items=[
        ['Test hesabının özeti',`/owner/dashboard.html?testRunId=${runId}`],
        ['Bekleyen yatırımlar',`/owner/requests.html?type=deposit&testRunId=${runId}`],
        ['Bekleyen çekimler',`/owner/requests.html?type=withdrawal&testRunId=${runId}`],
        ['Raporlar',result.reportUrl],
        ['Mutabakat',result.reconciliationUrl],
        ['İşlem geçmişi',`/owner/history.html?status=approved&testRunId=${runId}`]
      ];
      links.replaceChildren(...items.map(([label,href])=>{const a=document.createElement('a');a.textContent=label;a.href=href;return a;}));
      links.hidden=false;el('totpCode').value='';
      await loadUsers();
    }catch(error){show(error.message||'İşlem tamamlanamadı.',true);button.disabled=false;updateButton();}
  });
  loadUsers();
})();
