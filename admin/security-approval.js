(function(){
  const AUDIT_KEY='safepays_sensitive_changes_v59';
  function current(){ return window.SafeAdmin && window.SafeAdmin.current ? window.SafeAdmin.current() : null; }
  function audit(action, detail){
    try{
      const a=current();
      const list=JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]');
      list.unshift({id:'SEC-'+Date.now(),action,detail,adminId:a?.id||'',adminEmail:a?.email||'',at:new Date().toISOString()});
      localStorage.setItem(AUDIT_KEY,JSON.stringify(list.slice(0,500)));
    }catch(e){}
  }
  function verify(label){
    const a=current();
    if(!a) throw new Error('Admin oturumu bulunamadı.');
    if(!a.twoFA) throw new Error('Bu işlem için Google Authenticator / 2FA aktif olmalı. Profilim > 2FA Güvenliği bölümünden etkinleştirin.');
    const code=window.prompt((label||'Hassas değişiklik')+'\n\nGoogle Authenticator 6 haneli güvenlik kodunu girin:','');
    if(code===null) throw new Error('İşlem iptal edildi.');
    if(!/^\d{6}$/.test(String(code).trim())) throw new Error('6 haneli doğrulama kodu girin.');
    if(String(code).trim()!==String(a.code||'')) throw new Error('Güvenlik kodu hatalı. Değişiklik kaydedilmedi.');
    return a;
  }
  window.SafeApproval={verify,audit};
})();
