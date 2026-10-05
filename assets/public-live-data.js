(()=>{
  const fields={
    members:document.getElementById('plStatMembers'),
    activeUsers30Days:document.getElementById('plStatActive30'),
    transactions:document.getElementById('plStatTransactions'),
    approvedTransactions:document.getElementById('plStatApproved')
  };
  const updated=document.getElementById('plLiveUpdated');
  const kicker=document.getElementById('plLiveKicker'),disclosure=document.getElementById('plLiveDisclosure');
  if(!updated||!Object.values(fields).some(Boolean))return;
  const number=new Intl.NumberFormat('tr-TR');
  async function refresh(){
    try{
      const response=await fetch('/api/public/stats',{headers:{Accept:'application/json'},cache:'no-store'});
      if(!response.ok)throw new Error('stats unavailable');
      const data=await response.json();
      for(const [key,node] of Object.entries(fields))if(node)node.textContent=number.format(Math.max(0,Number(data[key])||0));
      if(data.simulation){
        if(kicker)kicker.lastChild.textContent=' TANITIM AMAÇLI TEMSİLİ GÖSTERGE';
        if(disclosure)disclosure.textContent='Bu değerler Owner tarafından belirlenen aralıkta otomatik değişen temsili sayaçlardır; gerçek işlem veya üye sayısı değildir.';
        document.querySelectorAll('.pl-live-card span').forEach(node=>node.textContent='Temsili sayaç');
        document.querySelectorAll('.pl-live-card small').forEach(node=>node.textContent='Otomatik değişen tanıtım değeri');
      }else{
        if(kicker)kicker.lastChild.textContent=' GÜNCEL PLATFORM VERİLERİ';
        if(disclosure)disclosure.textContent='Sunucudaki kayıtlı platform verileri.';
        const labels=['Üye hesabı','İşlem yapan üye','Toplam işlem','Onaylanan işlem'],notes=['Doğrulanmış toplam kayıt','Son 30 günde işlem yapan','Kayıtlı tüm işlemler','Başarıyla tamamlananlar'];
        document.querySelectorAll('.pl-live-card span').forEach((node,index)=>node.textContent=labels[index]||'Platform verisi');
        document.querySelectorAll('.pl-live-card small').forEach((node,index)=>node.textContent=notes[index]||'Sunucu verisi');
      }
      updated.textContent='Son güncelleme: '+new Intl.DateTimeFormat('tr-TR',{hour:'2-digit',minute:'2-digit'}).format(new Date(data.updatedAt||Date.now()));
      window.setTimeout(refresh,Math.max(30,Number(data.nextRefreshSeconds)||30)*1000);
    }catch(_){
      updated.textContent='Veriler şu anda alınamıyor';
      window.setTimeout(refresh,30000);
    }
  }
  refresh();
})();
