/* Client-side display profile only. Authorization is checked against /api/admin/me. */
(function(){
  const PROFILE_KEY='safepays_admin_session_profile';
  function current(){
    try{
      const profile=JSON.parse(sessionStorage.getItem(PROFILE_KEY)||'null');
      return profile&&['Super Admin','Team Admin'].includes(profile.role)?profile:null;
    }catch(_){return null;}
  }
  function setSessionProfile(profile){
    const role=profile?.role==='Team Admin'?'Team Admin':'Super Admin';
    const next={id:String(profile?.id||''),email:String(profile?.email||''),role,name:role,permissions:profile?.permissions&&typeof profile.permissions==='object'?profile.permissions:{}};
    sessionStorage.setItem(PROFILE_KEY,JSON.stringify(next));
    return next;
  }
  function clearSessionProfile(){
    sessionStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem('safepays_portal_user');
    localStorage.removeItem('safepays_admin_token');
  }
  function unavailable(){throw new Error('Bu işlem sunucu tarafında yapılandırılmadı.');}
  window.SafeAdmin={current,setSessionProfile,clearSessionProfile,updateSelf:unavailable,setSelfActive:unavailable};
})();
