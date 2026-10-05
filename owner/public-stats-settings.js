(()=>{
  const fields=['membersMin','membersMax','activeUsersMin','activeUsersMax','transactionsMin','transactionsMax','approvedMin','approvedMax'];
  const status=document.getElementById('publicStatsStatus');
  async function load(){try{const data=await adminFetch('/public-stats-display'),settings=data.settings||{};for(const field of fields)document.getElementById(field).value=Number(settings[field]||0);document.getElementById('statsIntervalSeconds').value=Number(settings.intervalSeconds||90);document.getElementById('displayStatsEnabled').checked=!!settings.enabled;status.textContent=settings.enabled?'Temsili gösterge etkin.':'Gerçek sunucu verileri gösteriliyor.';}catch(error){status.textContent='Sayaç ayarları yüklenemedi: '+error.message;}}
  async function save(){const button=document.getElementById('savePublicStats');button.disabled=true;status.textContent='Kaydediliyor…';const data={enabled:document.getElementById('displayStatsEnabled').checked,intervalSeconds:Number(document.getElementById('statsIntervalSeconds').value)};for(const field of fields)data[field]=Number(document.getElementById(field).value);try{const result=await adminFetch('/public-stats-display',{method:'POST',body:JSON.stringify(data)});status.textContent=result.settings.enabled?'Kaydedildi. Ana sayfada aralık içindeki temsili sayaçlar görünecek.':'Kaydedildi. Ana sayfada sunucudaki gerçek veriler görünecek.';}catch(error){status.textContent='Kaydedilemedi: '+error.message;}finally{button.disabled=false;}}
  document.getElementById('savePublicStats')?.addEventListener('click',save);
  load();
})();
