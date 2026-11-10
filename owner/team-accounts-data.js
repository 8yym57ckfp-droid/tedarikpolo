(()=>{
  const $=id=>document.getElementById(id),target=$('teamAccountContent'),form=$('teamAccountForm');
  if(!target||!form)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const permissionLabels={transactions:'Talepler',reports:'Raporlar',wallets:'Cüzdanlar',support:'Destek'};
  const actionBackdrop=$('teamActionBackdrop'),actionTitle=$('teamActionTitle'),actionDescription=$('teamActionDescription'),actionTotp=$('teamActionTotpCode'),actionStatus=$('teamActionStatus'),actionSubmit=$('teamActionSubmit');
  let accounts=[];
  let pendingTeamAction=null;
  function permissions(){return {dashboard:true,transactions:$('permTransactions').checked,reports:$('permReports').checked,wallets:$('permWallets').checked,support:$('permSupport').checked};}
  function setPermissions(value={}){$('permTransactions').checked=value.transactions!==false;$('permReports').checked=value.reports!==false;$('permWallets').checked=value.wallets!==false;$('permSupport').checked=value.support!==false;}
  function syncCollateralMode(){const paid=$('teamPaidChecksCapacity').checked,panel=$('teamCollateralSettings'),autoPauseSetting=$('teamCollateralAutoPauseSetting');if(panel)panel.hidden=paid;if(autoPauseSetting)autoPauseSetting.hidden=paid;if(paid)$('teamCollateralAutoPause').checked=false;}
  function controls(){const paid=$('teamPaidChecksCapacity').checked;return {walletLimit:Number($('teamWalletLimit').value||0),collateralTotal:paid?0:Number($('teamCollateralTotal').value||0),commissionPercent:Number($('teamCommissionPercent').value||0),collateralPausePercent:paid?0:Number($('teamCollateralPausePercent').value||0),allowSelfDisable:$('teamAllowSelfDisable').checked,collateralAutoPause:paid?false:$('teamCollateralAutoPause').checked};}
  function setControls(account={}){$('teamWalletLimit').value=Number(account.walletLimit||0);$('teamPaidChecksCapacity').checked=Number(account.collateralTotal||0)<=0;$('teamCollateralTotal').value=Number(account.collateralTotal||0);$('teamCollateralBalance').value=Number(account.collateralExposure||0);$('teamCommissionPercent').value=Number(account.commissionPercent??3);$('teamCollateralPausePercent').value=Number(account.collateralPausePercent??80);$('teamAllowSelfDisable').checked=!!account.allowSelfDisable;$('teamCollateralAutoPause').checked=!!account.collateralAutoPause;syncCollateralMode();}
  $('teamPaidChecksCapacity').addEventListener('change',syncCollateralMode);
  async function request(url,body){
    const response=await fetch('../api/owner/team-accounts'+url,{method:body?'POST':'GET',credentials:'include',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const data=await response.json().catch(()=>({error:'invalid_response'}));
    if(!response.ok)throw new Error(data.message||data.error||'Ekip hesabı işlemi tamamlanamadı.');
    return data;
  }
  function render(){
    if(!accounts.length){target.className='team-account-state';target.textContent='Henüz ekip hesabı eklenmemiş.';return;}
    target.className='team-account-table-wrap';
    target.innerHTML='<table class="team-account-table"><thead><tr><th>Hesap</th><th>E-posta</th><th>2FA</th><th>Cüzdan</th><th>Teminat kullanımı</th><th>Yatırım kapasitesi</th><th>Komisyon</th><th>Durum</th><th>Zincir doğrulaması</th><th>Erişimler</th><th>İşlemler</th></tr></thead><tbody>'+accounts.map(account=>{
      const access=Object.entries(permissionLabels).filter(([key])=>account.permissions?.[key]).map(([,label])=>`<span>${label}</span>`).join('')||'<span>Yok</span>';
      const collateralTotal=Number(account.collateralTotal||0),collateralExposure=Number(account.collateralExposure||0),threshold=Number(account.collateralPausePercent||80),commissionPercent=Number(account.commissionPercent??3);
      const collateral=collateralTotal?`${collateralExposure.toLocaleString('tr-TR')} / ${collateralTotal.toLocaleString('tr-TR')} USDT · ${Number(account.collateralAvailable||0).toLocaleString('tr-TR')} boş`:'Ayarlı değil';
      const twoFactor=account.twoFactorEnabled?'Açık':account.twoFactorSetupPending?'Kurulum bekliyor':'Kapalı';
      const accepting=account.acceptingDeposits===undefined?account.active&&!account.depositsPaused&&!account.collateralPaused:!!account.acceptingDeposits;
      const chainRequired=account.requireChainVerification!==false;
      const stateLabel=accepting?'Yatırım aktif':account.collateralPaused?'Teminat eşiği':account.investmentCapacityPaused?'Yatırım kapasitesi doldu':account.depositsPaused?'Yatırım duraklatıldı':'Yönetici duraklattı';
      return `<tr><td><b>${esc(account.id)}</b></td><td class="team-account-email">${esc(account.email)}</td><td>${twoFactor}</td><td>${Number(account.walletLimit||0)||'Sınırsız'}</td><td>${esc(collateral)}${account.collateralAutoPause?`<small class="team-account-sub">%${threshold} yatırım eşiği</small>`:''}${account.collateralPaused?'<small class="team-account-sub is-error">Yeni yatırımlar duraklatıldı · çekim ödemesiyle açılır</small>':''}</td><td><b>${Number(account.investmentCapacityAvailable||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:4})} USDT</b><small class="team-account-sub">Ödenen ${Number(account.paidChecks||0).toLocaleString('tr-TR')} · Yatırım ${Number(account.investmentsReceived||0).toLocaleString('tr-TR')} · Geri ödeme ${Number(account.repayments||0).toLocaleString('tr-TR')}</small><button class="team-row-action" type="button" onclick="recordTeamRepayment('${esc(account.id)}')">Geri ödeme kaydet</button></td><td><b>%${commissionPercent.toLocaleString('tr-TR')}</b><small class="team-account-sub">${Number(account.commissionEarned||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} USDT birikmiş</small></td><td><span class="team-account-badge ${accepting?'':'is-error'}">${stateLabel}</span></td><td class="team-chain-setting"><span class="team-account-badge ${chainRequired?'':'is-off'}">${chainRequired?'Zorunlu':'Kapalı'}</span><button class="team-row-action ${chainRequired?'danger':''}" type="button" onclick="toggleTeamChainVerification('${esc(account.id)}')">${chainRequired?'Doğrulamayı kapat':'Doğrulamayı aç'}</button></td><td><div class="team-account-permission-list">${access}</div></td><td><button class="team-row-action" type="button" onclick="editTeamAccount('${esc(account.id)}')">Düzenle</button><button class="team-row-action ${accepting?'danger':''}" type="button" onclick="toggleTeamAccount('${esc(account.id)}')">${accepting?'Yatırımı durdur':'Yatırımı aç'}</button><button class="team-row-action" type="button" onclick="toggleTeamTwoFactor('${esc(account.id)}')">${account.twoFactorEnabled?'2FA kapat':account.twoFactorSetupPending?'2FA doğrula':'2FA kur'}</button></td></tr>`;
    }).join('')+'</tbody></table>';
  }
  async function load(){
    target.textContent='Ekip hesapları yükleniyor…';
    try{const data=await request('',null);accounts=Array.isArray(data.accounts)?data.accounts:[];render();}
    catch(error){target.textContent=error.message||'Ekip hesapları alınamadı.';}
  }
  function closeTeamAction(){actionBackdrop.hidden=true;pendingTeamAction=null;actionTotp.value='';actionStatus.textContent='';actionStatus.className='team-action-dialog-status';}
  function openTeamAction(id,active){
    const account=accounts.find(item=>item.id===id);if(!account)return;
    pendingTeamAction={id,active};actionTotp.value='';actionStatus.textContent='';actionStatus.className='team-action-dialog-status';
    actionTitle.textContent=active?'Yatırım alımını aç':'Yatırım alımını durdur';
    actionDescription.textContent=active?`${account.email} hesabına yeni yatırım yönlendirmesi açılacak. Ekip hesabı giriş yapmaya ve çekim ödemeye devam eder. Owner doğrulama kodunu girip kaydet.`:`${account.email} hesabına yeni yatırım yönlendirmesi durdurulacak. Ekip hesabı giriş yapmaya ve çekim ödemeye devam eder. Owner doğrulama kodunu girip kaydet.`;
    actionSubmit.textContent=active?'Yatırımı aç':'Yatırımı durdur';actionBackdrop.hidden=false;actionTotp.focus();
  }
  function openTeamChainAction(id,requireChainVerification){
    const account=accounts.find(item=>item.id===id);if(!account)return;
    pendingTeamAction={id,requireChainVerification};actionTotp.value='';actionStatus.textContent='';actionStatus.className='team-action-dialog-status';
    actionTitle.textContent=requireChainVerification?'Zincir doğrulamasını aç':'Zincir doğrulamasını kapat';
    actionDescription.textContent=requireChainVerification?`${account.email} ekibinin yatırım ve çekim onaylarında blokzincir doğrulaması yeniden zorunlu olacak.`:`${account.email} ekibinin işlemleri blokzincirde doğrulanmadan onaylanabilecek. Bu ayar yalnızca bu ekibe uygulanır ve işlem audit kaydına yazılır.`;
    actionSubmit.textContent=requireChainVerification?'Doğrulamayı aç':'Doğrulamayı kapat';actionBackdrop.hidden=false;actionTotp.focus();
  }
  $('teamActionCancel').addEventListener('click',closeTeamAction);
  actionBackdrop.addEventListener('click',event=>{if(event.target===actionBackdrop)closeTeamAction();});
  actionBackdrop.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeTeamAction();}else if(event.key==='Enter'&&event.target===actionTotp){event.preventDefault();actionSubmit.click();}});
  actionSubmit.addEventListener('click',async()=>{
    if(!pendingTeamAction)return;
    const ownerTotpCode=actionTotp.value.trim();if(!/^\d{6}$/.test(ownerTotpCode)){actionStatus.textContent='6 haneli Owner doğrulama kodunu gir.';actionStatus.classList.add('is-error');actionTotp.focus();return;}
    const {id,active,requireChainVerification}=pendingTeamAction;actionSubmit.disabled=true;actionStatus.textContent='Sunucuya kaydediliyor…';actionStatus.className='team-action-dialog-status';
    try{
      if(requireChainVerification!==undefined){
        await request('/'+encodeURIComponent(id),{action:'set_chain_verification',enabled:requireChainVerification,ownerTotpCode});
        await load();$('teamAccountMessage').textContent=requireChainVerification?'Ekip için blokzincir doğrulaması açıldı.':'Ekip için blokzincir doğrulaması kapatıldı; onaylar audit kaydına işlenir.';closeTeamAction();return;
      }
      const result=await request('/'+encodeURIComponent(id),{action:'update',active,ownerTotpCode});
      if(result.account){accounts=accounts.map(item=>item.id===id?result.account:item);render();}
      await load();
      const updated=accounts.find(item=>item.id===id),accepting=updated?.acceptingDeposits===undefined?updated?.active&&!updated?.depositsPaused&&!updated?.collateralPaused:!!updated?.acceptingDeposits;
      if(active&&!accepting){
        if(updated?.collateralPaused){const threshold=Number(updated.collateralTotal||0)*Number(updated.collateralPausePercent||80)/100;actionStatus.textContent=`Owner isteği kaydedildi; ancak teminat eşiği nedeniyle yatırım kapalı. Kullanım ${Number(updated.collateralExposure||0).toLocaleString('tr-TR')} / ${threshold.toLocaleString('tr-TR')} USDT. Çekim ödemesi sonrası yeniden açılır.`;}
        else actionStatus.textContent='Sunucu yatırımı hâlâ pasif bildiriyor. Durum kaydedilemedi; tekrar dene veya yönetici kaydını kontrol et.';
        actionStatus.classList.add('is-error');return;
      }
      $('teamAccountMessage').textContent=active?'Yatırım alımı açıldı; ekip paneli güncel durumu birkaç saniye içinde yeniler.':'Yeni yatırım alımı durduruldu; ekip hesabı ve çekim işlemleri açık kalır.';
      closeTeamAction();
    }catch(error){actionStatus.textContent=error.message||'İşlem kaydedilemedi. Tekrar dene.';actionStatus.classList.add('is-error');}
    finally{actionSubmit.disabled=false;}
  });
  function resetForm({keepSetup=false}={}){
    $('teamAccountId').value='';$('teamEmail').value='';$('teamPassword').value='';$('teamEmail').readOnly=false;
    $('teamTotpSecret').value='';$('teamTotpSecret').disabled=false;if(!keepSetup)$('teamTwoFactorSetupPanel').hidden=true;$('teamTwoFactorCopyMessage').textContent='';
    $('saveTeamAccount').textContent='Ekip hesabı ekle';$('cancelTeamEdit').hidden=true;setPermissions({});setControls({});$('teamAccountMessage').textContent='';
  }
  window.editTeamAccount=id=>{
    const account=accounts.find(item=>item.id===id);if(!account)return;
    $('teamAccountId').value=account.id;$('teamEmail').value=account.email;$('teamPassword').value='';$('teamEmail').readOnly=false;$('teamTotpSecret').value='';$('teamTotpSecret').disabled=true;$('teamTwoFactorSetupPanel').hidden=true;
    setPermissions(account.permissions);setControls(account);$('saveTeamAccount').textContent='Değişiklikleri kaydet';$('cancelTeamEdit').hidden=false;
    $('teamAccountMessage').textContent='Parolayı değiştirmeyeceksen boş bırak.';form.scrollIntoView({behavior:'smooth',block:'center'});
  };
  window.recordTeamRepayment=async id=>{
    const account=accounts.find(item=>item.id===id);if(!account)return;
    const raw=prompt(`${account.email} için merkeze fiilen alınan geri ödeme tutarı (USDT):`);if(raw===null)return;
    let normalized=String(raw).replace(/\s/g,'');if(normalized.includes(',')&&normalized.includes('.'))normalized=normalized.lastIndexOf(',')>normalized.lastIndexOf('.')?normalized.replace(/\./g,'').replace(',','.'):normalized.replace(/,/g,'');else if(normalized.includes(','))normalized=normalized.replace(',','.');const amount=Number(normalized);if(!Number.isFinite(amount)||amount<=0){alert('Geçerli ve sıfırdan büyük bir tutar gir.');return;}
    const reason=prompt('Geri ödeme açıklaması:','Merkez kasaya alınan geri ödeme');if(reason===null)return;
    const ownerTotpCode=prompt('Kaydetmek için Owner Google Authenticator kodunu gir:');if(!ownerTotpCode)return;
    try{await request('/'+encodeURIComponent(id)+'/repayment',{amount,reason,ownerTotpCode});await load();$('teamAccountMessage').textContent='Geri ödeme kaydedildi; yatırım kapasitesi artırıldı.';}
    catch(error){alert(error.message||'Geri ödeme kaydedilemedi.');}
  };
  window.toggleTeamAccount=async id=>{
    const account=accounts.find(item=>item.id===id);if(!account)return;
    const accepting=account.acceptingDeposits===undefined?account.active&&!account.depositsPaused&&!account.collateralPaused:!!account.acceptingDeposits;openTeamAction(id,!accepting);
  };
  window.toggleTeamChainVerification=async id=>{
    const account=accounts.find(item=>item.id===id);if(!account)return;
    openTeamChainAction(id,account.requireChainVerification===false);
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
    if(account.twoFactorSetupPending){
      const teamTotpCode=prompt('Ekibin paylaştığınız anahtarla ürettiği 6 haneli kodu girin:');if(!teamTotpCode)return;
      const ownerTotpCode=prompt('İşlemi tamamlamak için Owner Google Authenticator kodunu girin:');if(!ownerTotpCode)return;
      try{await request('/'+encodeURIComponent(id),{action:'verify_2fa',teamTotpCode,ownerTotpCode});await load();}
      catch(error){alert(error.message||'Ekip 2FA kodu doğrulanamadı.');}
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
  function showTwoFactorSetup(setup){
    if(!setup?.secret)return;
    $('teamTwoFactorSecretValue').textContent=setup.secret;
    $('openTeamTwoFactorSetup').href=setup.otpauthUrl||'#';
    $('teamTwoFactorSetupPanel').hidden=false;
  }
  async function copyTwoFactorValue(value){
    if(!value)return;
    try{await navigator.clipboard.writeText(value);}
    catch(_){const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();document.execCommand('copy');field.remove();}
    $('teamTwoFactorCopyMessage').textContent='Kopyalandı. Anahtarı güvenli bir kanaldan ekiple paylaş.';
  }
  $('copyTeamTwoFactorSecret').addEventListener('click',()=>copyTwoFactorValue($('teamTwoFactorSecretValue').textContent));
  $('copyTeamTwoFactorUri').addEventListener('click',()=>copyTwoFactorValue($('openTeamTwoFactorSetup').href));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const id=$('teamAccountId').value,email=$('teamEmail').value.trim(),password=$('teamPassword').value;
    if(!id&&password.length<12){$('teamAccountMessage').textContent='Yeni hesap parolası en az 12 karakter olmalı.';return;}
    const ownerTotpCode=prompt('Kaydetmek için Owner Google Authenticator kodunu girin:');if(!ownerTotpCode)return;
    const payload={email,permissions:permissions(),ownerTotpCode,...controls()};if(password)payload.password=password;if(!id&&$('teamTotpSecret').value.trim())payload.totpSecret=$('teamTotpSecret').value.trim();
    $('saveTeamAccount').disabled=true;$('teamAccountMessage').textContent='Kaydediliyor…';
    try{
      let resultMessage='Ekip hesabı kaydedildi.';
      if(id){await request('/'+encodeURIComponent(id),{action:'update',...payload});$('teamAccountMessage').textContent='Ekip hesabı kaydedildi.';}
      else{
        const result=await request('',payload),setup=result.twoFactorSetup;showTwoFactorSetup(setup);
        if(setup)resultMessage='Hesap oluşturuldu. 2FA anahtarı aşağıda hazır; ekibe paylaşıp listeden “2FA doğrula” ile kurulumu tamamlayın. Doğrulanana kadar giriş kapalı.';
      }
      resetForm({keepSetup:!id});$('teamAccountMessage').textContent=resultMessage;await load();
    }
    catch(error){$('teamAccountMessage').textContent=error.message||'Ekip hesabı kaydedilemedi.';}
    finally{$('saveTeamAccount').disabled=false;}
  });
  load();
})();
