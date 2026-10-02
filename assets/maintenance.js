(function(){
  function scope(){const p=location.pathname;return p.includes('/admin/')?'panel':(p.includes('/owner/')?'owner':'site')}
  function bypass(){return scope()==='owner'||location.pathname.endsWith('/maintenance.html')}
  async function get(){
    const r=await fetch('/api/system/maintenance',{cache:'no-store'});if(!r.ok)throw Error('Bakım ayarları alınamadı.');const d=await r.json();return d.maintenance;
  }
  function active(item){if(!item||!item.enabled)return false;if(item.until&&new Date(item.until).getTime()<=Date.now())return false;return true}
  async function guard(){
    if(bypass())return;
    try{const m=await get();const s=scope();const item=m?.[s];if(active(item)){sessionStorage.setItem('safepays_maintenance_return',location.href);location.replace('/maintenance.html?scope='+encodeURIComponent(s));}}catch(_){/* Server settings are authoritative; do not use stale browser data. */}
  }
  window.SafePaysMaintenance={get,active,scope,guard};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',guard);else guard();
})();
