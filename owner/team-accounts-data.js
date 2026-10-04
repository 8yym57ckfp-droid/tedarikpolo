(()=>{
  const $=id=>document.getElementById(id),target=$('teamAccountContent'),form=$('teamAccountForm');
  if(!target||!form)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const permissionLabels={transactions:'Talepler',reports:'Raporlar',wallets:'Cüzdanlar',support:'Destek'};
  let accounts=[];
  function permissions(){return {dashboard:true,transactions:$('permTransactions').checked,reports:$('permReports').checked,wallets:$('permWallets').checked,support:$('permSupport').checked};}
  function setPermissions(value={}){$('permTransactions').checked=value.transactions!==false;$('permReports').checked=value.reports!==false;$('permWallets').checked=value.wallets!==false;$('permSupport').checked=value.support!==false;}
  function controls(){return {walletLimit:Number($('teamWalletLimit').value||0),collateralTotal:Number($('teamCollateralTotal').value||0),commissionPercent:Number($('teamCommissionPercent').value||0),collateralPausePercent:Number($('teamCollateralPausePercent').value||80),allowSelfDisable:$('teamAllowSelfDisable').checked,collateralAutoPause:$('teamCollateralAutoPause').checked};}
  function setControls(account={}){$('teamWalletLimit').value=Number(account.walletLimit||0);$('teamCollateralTotal').value=Number(account.collateralTotal||0);$('teamCollateralBalance').value=Number(account.collateralExposure||0);$('teamCommissionPercent').value=Number(account.commissionPercent??3);$('teamCollateralPausePercent').value=Number(account.collateralPausePercent||80);$('teamAllowSelfDisable').checked=!!account.allowSelfDisable;$('teamCollateralAutoPause').checked=!!account.collateralAutoPause;}
  async function request(url,body){
    const response=await fetch('../api/owner/team-accounts'+url,{method:body?'POST':'GET',credentials:'include',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const data=await response.json().catch(()=>({error:'invalid_response'}));
    if(!response.ok)throw new Error(data.message||data.error||'Ekip hesabı işlemi tamamlanamadı.');
    return data;
  }
  function render(){
    if(!accounts.length){target.className='team-account-state';target.textContent='Henüz ekip hesabı eklenmemiş.';return;}
    target.className='team-account-table-wrap';
    target.innerHTML='<table class="team-account-table"><thead><tr><th>Hesap</th><th>E-posta</th><th>2FA</th><th>Cüzdan</th><th>Teminat kullanımı</th><th>Komisyon</th><th>Durum</th><th>Erişimler</th><th>İşlemler</th></tr></thead><tbody>'+accounts.map(account=>{
      const access=Object.entries(permissionLabels).filter(([key])=>account.permissions?.[key]).map(([,label])=>`<span>${label}</span>`).join('')||'<span>Yok</span>';
      const collateralTotal=Number(account.collateralTotal||0),collateralExposure=Number(account.collateralExposure||0),threshold=Number(account.collateralPausePercent||80),commissionPercent=Number(account.commissionPercent??3);
      const collateral=collateralTotal?`${collateralExposure.toLocaleString('tr-TR')} / ${collateralTotal.toLocaleString('tr-TR')} USDT · ${Number(account.collateralAvailable||0).toLocaleString('tr-TR')} boş`:'Ayarlı değil';
      const twoFactor=account.twoFactorEnabled?'Açık':account.twoFactorSetupPending?'Kurulum bekliyor':'Kapalı';
      return `<tr><td><b>${esc(account.id)}</b></td><td class="team-account-email">${esc(account.email)}</td><td>${twoFactor}</td><td>${Number(account.walletLimit||0)||'Sınırsız'}</td><td>${esc(collateral)}${account.collateralAutoPause?`<small class="team-account-sub">%${threshold} yatırım eşiği</small>`:''}${account.collateralPaused?'<small class="team-account-sub is-error">Yeni yatırımlar duraklatıldı · çekim ödemesiyle açılır</small>':''}</td><td><b>%${commissionPercent.toLocaleString('tr-TR')}</b><small class="team-account-sub">${Number(account.commissionEarned||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} USDT birikmiş</small></td><td><span class="team-account-badge ${account.active&&!account.collateralPaused?'':'is-error'}">${account.collateralPaused?'Teminat eşiği':account.active?'Aktif':'Pasif'}</span></td><td><div class="team-account-permission-list">${access}</div></td><td><button class="team-row-action" type="button" onclick="editTeamAccount('${esc(account.id)}')">Düzenle</button><button class="team-row-action ${account.active?'danger':''}" type="button" onclick="toggleTeamAccount('${esc(account.id)}')">${account.active?'Pasif yap':'Aktif yap'}</button><button class="team-row-action" type="button" onclick="toggleTeamTwoFactor('${esc(account.id)}')">2FA ${account.twoFactorEnabled?'kapat':'kur'}</button></td></tr>`;
    }).join('')+'</tbody></table>';
  }
  async function load(){
    target.textContent='Ekip hesapları yükleniyor…';
    try{const data=await request('',null);accounts=Array.isArray(data.accounts)?data.accounts:[];render();}
    catch(error){target.textContent=error.message||'Ekip hesapları alınamadı.';}
  }
  function resetForm(){
    $('teamAccountId').value='';$('teamEmail').value='';$('teamPassword').value='';$('teamEmail').readOnly=false;
    $('saveTeamAccount').textContent='Ekip hesabı ekle';$('cancelTeamEdit').hidden=true;setPermissions({});setControls({});$('teamAccountMessage').textContent='';
  }
  window.editTeamAccount=id=>{
    const account=accounts.find(item=>item.id===id);if(!account)return;
    $('teamAccountId').value=account.id;$('teamEmail').value=account.email;$('teamPassword').value='';$('teamEmail').readOnly=false;
    setPermissions(account.permissions);setControls(account);$('saveTeamAccount').textContent='Değişiklikleri kaydet';$('cancelTeamEdit').hidden=false;
    $('teamAccountMessage').textContent='Parolayı değiştirmeyeceksen boş bırak.';form.scrollIntoView({behavior:'smooth',block:'center'});
  };
  window.toggleTeamAccount=async id=>{
    const account=accounts.find(item=>item.id===id);if(!account)return;
    const active=!account.active;if(!confirm(`${account.email} hesabı ${active?'aktif':'pasif'} yapılsın mı?`))return;
    const ownerTotpCode=prompt('Owner Google Authenticator kodunu girin:');if(!ownerTotpCode)return;
    try{await request('/'+encodeURIComponent(id),{action:'update',active,ownerTotpCode,permissions:account.permissions});await load();}
    catch(error){alert(error.message||'Hesap durumu değiştirilemedi.');}
  };
  window.toggleTeamTwoFactor=async id=>{
    const account=accounts.find(item=>item.id===id);if(!account)return;
    if(account.twoFactorEnabled){
      if(!confirm(`${account.email} hesabında 2FA kapatılsın mı?`))return;
      const ownerTotpCode=prompt('Owner Google Authenticator kodunu girin:');if(!ownerTotpCode)return;
      try{await request('/'+encodeURIComponent(id),{action:'disable_2fa',ownerTotpCode});await load();}
      catch(error){alert(error.message||'2FA kapatılamadı.');}
      return;
    }
    const ownerTotpCode=prompt('Owner Google Authenticator kodunu girin:');if(!ownerTotpCode)return;
    try{
      const setup=await request('/'+encodeURIComponent(id),{action:'begin_2fa',ownerTotpCode});
      alert(`Bu anahtarı ekip hesabının doğrulayıcı uygulamasına ekleyin:\n\n${setup.secret}\n\nKurulum için uygulamada oluşan 6 haneli kodu bir sonraki adımda girin.`);
      const teamTotpCode=prompt('Ekip doğrulayıcı uygulamasındaki 6 haneli kod:');if(!teamTotpCode)return;
      const confirmOwnerCode=prompt('İşlemi tamamlamak için Owner doğrulama kodunu tekrar girin:');if(!confirmOwnerCode)return;
      await request('/'+encodeURIComponent(id),{action:'verify_2fa',teamTotpCode,ownerTotpCode:confirmOwnerCode});await load();
    }catch(error){alert(error.message||'2FA kurulamadı.');}
  };
  $('cancelTeamEdit').addEventListener('click',resetForm);
  form.addEventListener('submit',async event=>{
    event.preventDefault();const id=$('teamAccountId').value,email=$('teamEmail').value.trim(),password=$('teamPassword').value;
    if(!id&&password.length<12){$('teamAccountMessage').textContent='Yeni hesap parolası en az 12 karakter olmalı.';return;}
    const ownerTotpCode=prompt('Kaydetmek için Owner Google Authenticator kodunu girin:');if(!ownerTotpCode)return;
    const payload={email,permissions:permissions(),ownerTotpCode,...controls()};if(password)payload.password=password;
    $('saveTeamAccount').disabled=true;$('teamAccountMessage').textContent='Kaydediliyor…';
    try{
      let resultMessage='Ekip hesabı kaydedildi.';
      if(id){await request('/'+encodeURIComponent(id),{action:'update',...payload});$('teamAccountMessage').textContent='Ekip hesabı kaydedildi.';}
      else{
        const result=await request('',payload),setup=result.twoFactorSetup;
        if(setup){alert(`Ekip hesabı için doğrulayıcı anahtarı:\n\n${setup.secret}\n\nAnahtarı ekip telefonundaki doğrulayıcı uygulamasına ekleyin.`);const teamTotpCode=prompt('Ekip doğrulayıcı uygulamasındaki 6 haneli kod:'),confirmOwnerCode=teamTotpCode?prompt('2FA kurulumunu tamamlamak için Owner doğrulama kodunu girin:'):null;if(teamTotpCode&&confirmOwnerCode)await request('/'+encodeURIComponent(result.account.id),{action:'verify_2fa',teamTotpCode,ownerTotpCode:confirmOwnerCode});else resultMessage='Hesap oluşturuldu; 2FA kurulumu tamamlanana kadar giriş kapalı kalır.';}
      }
      resetForm();$('teamAccountMessage').textContent=resultMessage;await load();
    }
    catch(error){$('teamAccountMessage').textContent=error.message||'Ekip hesabı kaydedilemedi.';}
    finally{$('saveTeamAccount').disabled=false;}
  });
  load();
})();
