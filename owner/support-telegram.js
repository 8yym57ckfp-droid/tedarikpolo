(()=>{
  const byId=id=>document.getElementById(id);
  const status=byId('telegramSupportStatus');
  async function loadTelegram(){
    try{
      const data=await adminFetch('/support/telegram');
      const telegram=data.telegram||{};
      byId('telegramChatIds').value=(telegram.chatIds||[]).join(', ');
      byId('telegramBotToken').placeholder=telegram.configured?`Kayıtlı token: ${telegram.tokenHint||'gizli'} · Boş bırakırsanız değişmez`:'Telegram bot tokenı';
      status.textContent=telegram.configured?'Telegram bot kayıtlı. Mesajlar bağlı sohbetlere yönlendiriliyor.':'Telegram bağlantısı henüz kurulmadı.';
    }catch(error){status.textContent='Telegram ayarları alınamadı: '+error.message;}
  }
  async function saveTelegram(){
    const button=byId('saveTelegramSupport');button.disabled=true;status.textContent='Bağlantı kaydediliyor…';
    try{
      const data=await adminFetch('/support/telegram',{method:'POST',body:JSON.stringify({botToken:byId('telegramBotToken').value.trim(),chatIds:byId('telegramChatIds').value})});
      byId('telegramBotToken').value='';byId('telegramBotToken').placeholder=`Kayıtlı token: ${data.telegram?.tokenHint||'gizli'} · Boş bırakırsanız değişmez`;
      status.textContent=data.webhook?.configured?'Telegram webhook hazır. Mesaj yönlendirme ve /reply yanıtları etkin.':data.webhook?.error||'Ayarlar kaydedildi; webhook durumu kontrol edilmeli.';
    }catch(error){status.textContent='Kaydedilemedi: '+error.message;}
    finally{button.disabled=false;}
  }
  byId('saveTelegramSupport')?.addEventListener('click',saveTelegram);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadTelegram,{once:true});else loadTelegram();
})();
