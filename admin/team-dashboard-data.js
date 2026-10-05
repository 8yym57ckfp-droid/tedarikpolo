(()=>{
  const byId=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value||0).toLocaleString('tr-TR');
  const amount=value=>Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:4})+' USDT';
  const cashUpdateTime=()=>new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function updateTeamDepositState(admin={}){
    const status=byId('teamDepositStatus'),statusText=byId('teamDepositStatusText');
    if(!status||!statusText)return;
    const manuallyPaused=!!admin.depositsPaused,collateralPaused=!!admin.collateralPaused,accountActive=admin.active!==false;
    const accepting=admin.acceptingDeposits===undefined?accountActive&&!manuallyPaused&&!collateralPaused:!!admin.acceptingDeposits;
    status.dataset.state=accepting?'active':'paused';
    statusText.textContent=accepting?'Yatırım alımı aktif':!accountActive?'Yatırım alımı pasif · yöneticiye başvur':collateralPaused?'Yatırım pasif · teminat sınırı':manuallyPaused?'Yatırım duraklatıldı · yeniden açılabilir':'Yatırım alımı pasif';
    const total=Number(admin.collateralTotal||0),note=byId('teamCashNote');
    if(note)note.textContent=total>0?`Toplam teminat ${amount(total)}${accepting?' · çekim ödemeleriyle güncellenir':' · yeni yatırımlar duraklatıldı'}`:accepting?'Teminat sınırı tanımlanmamış':'Yeni yatırım yönlendirmesi duraklatıldı';
    const toggle=byId('selfDisableTeam'),label=byId('teamActiveLabel');
    if(toggle){toggle.setAttribute('aria-checked',accepting?'true':'false');toggle.setAttribute('aria-label',accepting?'Yeni yatırım yönlendirmesini durdur':!accountActive?'Yatırım alımını açmak için yöneticinizle iletişime geçin':collateralPaused?'Teminat kapasitesi açılana kadar bekleyin':manuallyPaused?'Yeni yatırım yönlendirmesini yeniden aç':'Yatırım durumu pasif');}
    if(label)label.textContent='Yatırım alımı';
  }
  function updateTeamCash(admin){
    const indicator=byId('teamCashIndicator');if(!indicator)return;
    updateTeamDepositState(admin);
    const total=Number(admin.collateralTotal||0);
    byId('teamCashUsed').textContent=amount(admin.collateralExposure);
    byId('teamCashAvailable').textContent=total>0?amount(admin.collateralAvailable):'Sınırsız';
    byId('teamCashUpdated').textContent='Güncel · '+cashUpdateTime();
    indicator.dataset.state='live';indicator.setAttribute('aria-busy','false');
  }
  function markTeamCashStale(){
    const indicator=byId('teamCashIndicator');if(!indicator)return;
    indicator.dataset.state='stale';indicator.setAttribute('aria-busy','false');
    byId('teamCashUpdated').textContent='Bağlantı yok · '+cashUpdateTime();
    const status=byId('teamDepositStatus'),statusText=byId('teamDepositStatusText');
    if(status)status.dataset.state='stale';
    if(statusText)statusText.textContent='Durum güncellenemedi';
  }
  let cashRefreshInFlight=false;
  async function refreshTeamCash(){
    if(cashRefreshInFlight)return;cashRefreshInFlight=true;
    try{const profile=await adminFetch('/me');updateTeamCash(profile.admin||{});}
    catch(_){markTeamCashStale();}
    finally{cashRefreshInFlight=false;}
  }
  const statusLabel={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi'};
  let overviewTransactions=[],overviewMembers=new Map(),overviewTeam={};
  window.copyTeamOverviewTransaction=id=>{const tx=overviewTransactions.find(item=>String(item.id)===String(id));if(tx)return window.copySupportTransactionDetails?.(tx,overviewMembers.get(String(tx.userId))||{},overviewTeam);};
  const dialog=byId('teamDialogBackdrop'),dialogTitle=byId('teamDialogTitle'),dialogMessage=byId('teamDialogMessage'),dialogKicker=byId('teamDialogKicker'),dialogIcon=byId('teamDialogIcon'),dialogCancel=byId('teamDialogCancel'),dialogConfirm=byId('teamDialogConfirm');
  let dialogResolve=null,dialogOpener=null;
  function closeTeamDialog(result=false){if(!dialog||dialog.hidden)return;dialog.classList.remove('is-open');dialog.hidden=true;document.body.classList.remove('team-dialog-open');const resolve=dialogResolve;dialogResolve=null;if(dialogOpener?.isConnected)dialogOpener.focus();dialogOpener=null;resolve?.(result);}
  function showTeamDialog({title,message,kicker='HESAP DURUMU',confirmText='Tamam',cancelText='',danger=false,icon='!'}){if(!dialog)return Promise.resolve(false);dialogResolve&&closeTeamDialog(false);dialogOpener=document.activeElement;dialogTitle.textContent=title;dialogMessage.textContent=message;dialogKicker.textContent=kicker;dialogIcon.textContent=icon;dialogCancel.textContent=cancelText||'Vazgeç';dialogCancel.hidden=!cancelText;dialogConfirm.textContent=confirmText;dialogConfirm.classList.toggle('team-dialog-danger',danger);dialogConfirm.classList.toggle('team-dialog-primary',!danger);dialog.hidden=false;document.body.classList.add('team-dialog-open');requestAnimationFrame(()=>{dialog.classList.add('is-open');(cancelText?dialogCancel:dialogConfirm).focus();});return new Promise(resolve=>{dialogResolve=resolve;});}
  dialogCancel?.addEventListener('click',()=>closeTeamDialog(false));
  dialogConfirm?.addEventListener('click',()=>closeTeamDialog(true));
  dialog?.addEventListener('click',event=>{if(event.target===dialog)closeTeamDialog(false);});
  document.addEventListener('keydown',event=>{if(dialog?.hidden)return;if(event.key==='Escape'){event.preventDefault();closeTeamDialog(false);}if(event.key==='Tab'){const focusable=[dialogCancel,dialogConfirm].filter(button=>button&&!button.hidden&&!button.disabled);if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  async function loadTeamOverview(){
    const rows=byId('recentRows');
    try{
      const [stats,data,profile,userData]=await Promise.all([adminFetch('/stats'),adminFetch('/transactions'),adminFetch('/me'),adminFetch('/users').catch(()=>({users:[]}))]);
      const admin=profile.admin||{},selfDisable=byId('selfDisableTeam'),selfDisableControl=byId('selfDisableTeamControl');
      overviewTransactions=Array.isArray(data.transactions)?data.transactions:[];overviewMembers=new Map((userData.users||[]).map(user=>[String(user.id),user]));overviewTeam=admin;
      updateTeamCash(admin);
      if(selfDisable&&selfDisableControl){
        selfDisableControl.hidden=!admin.allowSelfDisable;
        let manuallyPaused=!!admin.depositsPaused;
        selfDisable.onclick=async()=>{
          if(selfDisable.disabled)return;
          selfDisable.disabled=true;
          try{
            let latestAdmin=admin;
            try{latestAdmin=(await adminFetch('/me',{cache:'no-store'})).admin||admin;manuallyPaused=!!latestAdmin.depositsPaused;}
            catch(error){await showTeamDialog({title:'Durum doğrulanamadı',message:error.message||'Hesap durumu alınamadı. Bağlantınızı kontrol edip tekrar deneyin.',kicker:'İŞLEM TAMAMLANAMADI',confirmText:'Anladım',icon:'×'});return;}
            const accepting=latestAdmin.acceptingDeposits===undefined?latestAdmin.active!==false&&!manuallyPaused&&!latestAdmin.collateralPaused:!!latestAdmin.acceptingDeposits;
            if(manuallyPaused&&latestAdmin.active===false){
              await showTeamDialog({title:'Yatırım alımı Owner tarafından durduruldu',message:'Owner hesabı pasife aldığı için yatırım alımını ekip olarak açamazsınız. Lütfen yöneticinizle iletişime geçin.',kicker:'YÖNETİCİ ONAYI GEREKİYOR',confirmText:'Anladım',icon:'!'});
              return;
            }
            if(manuallyPaused&&latestAdmin.collateralPaused){
              await showTeamDialog({title:'Teminat kapasitesi dolu',message:'Çekim ödemeleri kapasiteyi açınca yatırım alımını yeniden başlatabilirsiniz.',kicker:'TEMİNAT SINIRI',confirmText:'Anladım',icon:'!'});
              return;
            }
            if(!accepting&&!manuallyPaused){
              const ownerPaused=latestAdmin.active===false;
              const message=ownerPaused?'Owner hesabı pasife aldığı için yeni yatırımı yalnızca Owner açabilir. Lütfen yöneticinizle iletişime geçin.':'Teminat kullanım sınırına ulaşıldığı için yeni yatırım alımı beklemede. Çekim ödemeleri kapasiteyi açınca tekrar deneyebilirsiniz.';
              await showTeamDialog({title:'Yatırım alımı pasif',message,kicker:ownerPaused?'YÖNETİCİ ONAYI GEREKİYOR':'TEMİNAT SINIRI',confirmText:'Anladım',icon:'!'});
              return;
            }
            const nextPaused=!manuallyPaused;
            const accepted=await showTeamDialog({title:nextPaused?'Yeni yatırım alımı durdurulsun mu?':'Yeni yatırım alımı yeniden açılsın mı?',message:nextPaused?'Bu ekibe bağlı cüzdanlara yeni yatırım yönlendirmesi durur. Paneliniz açık kalır; çekim taleplerini inceleyip ödemeye devam edebilirsiniz. Hesap Owner tarafından pasife alınmadığı sürece bu düğmeden yatırımı yeniden açabilirsiniz.':'Bu ekibe bağlı cüzdanlara yeni yatırım yönlendirmesi yeniden başlar. Teminat sınırı veya Owner kısıtlaması varsa yatırım yönlendirilmez.',confirmText:nextPaused?'Yatırımı durdur':'Yatırımı yeniden aç',cancelText:'Vazgeç',danger:nextPaused,icon:nextPaused?'Ⅱ':'▶'});
            if(!accepted)return;
            selfDisable.setAttribute('aria-checked',nextPaused?'false':'true');
            try{
              const result=await adminFetch('/team/self-disable',{method:'POST',body:JSON.stringify({depositsPaused:nextPaused})});
              manuallyPaused=!!result.depositsPaused;
              updateTeamDepositState({...latestAdmin,...result,acceptingDeposits:result.active!==false&&!manuallyPaused&&!latestAdmin.collateralPaused});
              await refreshTeamCash();
            }catch(error){
              selfDisable.setAttribute('aria-checked',latestAdmin.active!==false&&!manuallyPaused&&!latestAdmin.collateralPaused?'true':'false');
              await showTeamDialog({title:'Yatırım durumu değiştirilemedi',message:error.message||'İşlem sırasında bir hata oluştu. Tekrar deneyin.',kicker:'İŞLEM TAMAMLANAMADI',confirmText:'Anladım',icon:'×'});
            }
          }finally{selfDisable.disabled=false;}
        };
      }
      byId('teamLifetimeCommission').textContent=amount(admin.commissionEarned);
      byId('teamCommissionRate').textContent=`Onaylı yatırımlar · ekip payı %${Number(admin.commissionPercent||0).toLocaleString('tr-TR')}`;
      byId('teamCollateralTotal').textContent=amount(admin.collateralTotal);
      byId('teamCollateralNote').textContent=Number(admin.collateralTotal||0)>0?`${amount(admin.collateralExposure)} kullanım · ${amount(admin.collateralAvailable)} kapasite${admin.collateralPaused?' · yeni yatırımlar duraklatıldı':''}`:'Teminat sınırı ayarlanmamış';
      const tx=overviewTransactions;
      const pending=tx.filter(x=>x.status==='pending');
      byId('pendingCount').textContent=number(stats.pending);
      byId('pendingNote').textContent=`${pending.filter(x=>x.type==='deposit').length} yatırım · ${pending.filter(x=>x.type==='withdrawal').length} çekim`;
      byId('approvedCount').textContent=number(stats.approved);
      const recent=tx.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,8);
      rows.innerHTML=recent.map(x=>{
        const type=x.type==='deposit'?'Yatırım':x.type==='withdrawal'?'Çekim':x.type||'—';
        const status=statusLabel[x.status]||escapeHtml(x.status||'—');
        const date=x.createdAt?new Date(x.createdAt).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}):'—';
        return `<tr><td><a href="requests.html?open=${encodeURIComponent(x.id||'')}" class="overview-link">${escapeHtml(String(x.id||'—').slice(0,14))}</a></td><td>${escapeHtml(type)}</td><td>${escapeHtml(x.network||'—')}</td><td><b>${amount(x.amount)}</b></td><td><span class="overview-status ${escapeHtml(x.status||'')}">${status}</span></td><td>${escapeHtml(date)}</td><td><button class="finance-copy-transaction" type="button" onclick="copyTeamOverviewTransaction('${escapeHtml(x.id)}')">Kopyala</button></td></tr>`;
      }).join('')||'<tr><td class="overview-empty" colspan="7">Henüz işlem kaydı yok.</td></tr>';
      byId('updatedAt').textContent='Son güncelleme: '+new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    }catch(_){
      rows.innerHTML='<tr><td class="overview-empty" colspan="6">Sunucu bilgileri alınamadı. Oturumu yenileyip tekrar dene.</td></tr>';
      byId('updatedAt').textContent='Bilgiler alınamadı';
    }
  }
  byId('refreshOverview')?.addEventListener('click',loadTeamOverview);
  loadTeamOverview();
  setInterval(loadTeamOverview,30000);
  setInterval(refreshTeamCash,15000);
})();
