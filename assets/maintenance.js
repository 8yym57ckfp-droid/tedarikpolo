(function(){
  const KEY='safepays_maintenance_v1';
  function local(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}}
  function saveLocal(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
  function scope(){const p=location.pathname;return p.includes('/admin/')?'panel':(p.includes('/owner/')?'owner':'site')}
  function bypass(){return scope()==='owner'||location.pathname.endsWith('/maintenance.html')}
  async function get(){
    try{const r=await fetch('/api/system/maintenance',{cache:'no-store'});if(!r.ok)throw Error('api');const d=await r.json();saveLocal(d.maintenance);return d.maintenance}catch(e){return local()||{site:{enabled:false},panel:{enabled:false}}}
  }
  function active(item){if(!item||!item.enabled)return false;if(item.until&&new Date(item.until).getTime()<=Date.now())return false;return true}
  async function guard(){
    if(bypass())return;
    const m=await get();const s=scope();const item=m?.[s];
    if(active(item)){sessionStorage.setItem('safepays_maintenance_return',location.href);location.replace('/maintenance.html?scope='+encodeURIComponent(s));}
  }
  window.SafePaysMaintenance={get,saveLocal,active,scope,guard};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',guard);else guard();
})();
