(()=>{
  const byId=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value||0).toLocaleString('tr-TR');
  const amount=value=>Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:4})+' USDT';
  const cashUpdateTime=()=>new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function updateTeamCash(admin){
    const indicator=byId('teamCashIndicator');if(!indicator)return;
    const total=Number(admin.collateralTotal||0);
    byId('teamCashUsed').textContent=amount(admin.collateralExposure);
    byId('teamCashAvailable').textContent=total>0?amount(admin.collateralAvailable):'Sınırsız';
    const note=indicator.querySelector('.team-live-cash-note');
    if(note)note.textContent=total>0?`Toplam teminat ${amount(total)}${admin.collateralPaused?' · yatırımlar duraklatıldı':' · çekim ödemeleriyle güncellenir'}`:'Teminat sınırı tanımlanmamış';
    byId('teamCashUpdated').textContent='Güncel · '+cashUpdateTime();
    indicator.dataset.state='live';indicator.setAttribute('aria-busy','false');
  }
  function markTeamCashStale(){
    const indicator=byId('teamCashIndicator');if(!indicator)return;
    indicator.dataset.state='stale';indicator.setAttribute('aria-busy','false');
    byId('teamCashUpdated').textContent='Bağlantı yok · '+cashUpdateTime();
  }
  let cashRefreshInFlight=false;
  async function refreshTeamCash(){
    if(cashRefreshInFlight)return;cashRefreshInFlight=true;
    try{const profile=await adminFetch('/me');updateTeamCash(profile.admin||{});}
    catch(_){markTeamCashStale();}
    finally{cashRefreshInFlight=false;}
  }
  const statusLabel={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi'};
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
      const [stats,data,profile]=await Promise.all([adminFetch('/stats'),adminFetch('/transactions'),adminFetch('/me')]);
      const admin=profile.admin||{},selfDisable=byId('selfDisableTeam'),selfDisableControl=byId('selfDisableTeamControl');
      updateTeamCash(admin);
      if(selfDisable&&selfDisableControl){
        selfDisableControl.hidden=!admin.allowSelfDisable;
        const setSwitch=enabled=>{selfDisable.setAttribute('aria-checked',enabled?'true':'false');byId('teamActiveLabel').textContent=enabled?'Hesabım aktif':'Hesabım pasif';};
        setSwitch(true);
        selfDisable.onclick=async()=>{
          const accepted=await showTeamDialog({title:'Hesap pasife alınsın mı?',message:'Oturumunuz kapatılacak. Bu ekip hesabına bağlı cüzdanlara yeni yatırım yönlendirilmesi durdurulacak.',confirmText:'Evet, pasife al',cancelText:'Vazgeç',danger:true});
          if(!accepted)return;
          selfDisable.disabled=true;setSwitch(false);
          try{await adminFetch('/team/self-disable',{method:'POST',body:JSON.stringify({})});location.replace('login.html?disabled=1');}
          catch(error){setSwitch(true);selfDisable.disabled=false;await showTeamDialog({title:'Hesap pasife alınamadı',message:error.message||'İşlem sırasında bir hata oluştu. Tekrar deneyin veya yöneticinizle iletişime geçin.',kicker:'İŞLEM TAMAMLANAMADI',confirmText:'Anladım',icon:'×'});}
        };
      }
      byId('teamLifetimeCommission').textContent=amount(admin.commissionEarned);
      byId('teamCommissionRate').textContent=`Onaylı yatırımlar · ekip payı %${Number(admin.commissionPercent||0).toLocaleString('tr-TR')}`;
      byId('teamCollateralTotal').textContent=amount(admin.collateralTotal);
      byId('teamCollateralNote').textContent=Number(admin.collateralTotal||0)>0?`${amount(admin.collateralExposure)} kullanım · ${amount(admin.collateralAvailable)} kapasite${admin.collateralPaused?' · yeni yatırımlar duraklatıldı':''}`:'Teminat sınırı ayarlanmamış';
      const tx=Array.isArray(data.transactions)?data.transactions:[];
      const pending=tx.filter(x=>x.status==='pending');
      byId('pendingCount').textContent=number(stats.pending);
      byId('pendingNote').textContent=`${pending.filter(x=>x.type==='deposit').length} yatırım · ${pending.filter(x=>x.type==='withdrawal').length} çekim`;
      byId('approvedCount').textContent=number(stats.approved);
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
  setInterval(refreshTeamCash,15000);
})();
