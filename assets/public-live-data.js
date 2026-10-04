(()=>{
  const fields={
    members:document.getElementById('plStatMembers'),
    activeUsers30Days:document.getElementById('plStatActive30'),
    transactions:document.getElementById('plStatTransactions'),
    approvedTransactions:document.getElementById('plStatApproved')
  };
  const updated=document.getElementById('plLiveUpdated');
  if(!updated||!Object.values(fields).some(Boolean))return;
  const number=new Intl.NumberFormat('tr-TR');
  async function refresh(){
    try{
      const response=await fetch('/api/public/stats',{headers:{Accept:'application/json'},cache:'no-store'});
      if(!response.ok)throw new Error('stats unavailable');
      const data=await response.json();
      for(const [key,node] of Object.entries(fields))if(node)node.textContent=number.format(Math.max(0,Number(data[key])||0));
      updated.textContent='Son güncelleme: '+new Intl.DateTimeFormat('tr-TR',{hour:'2-digit',minute:'2-digit'}).format(new Date(data.updatedAt||Date.now()));
    }catch(_){
      updated.textContent='Veriler şu anda alınamıyor';
    }
  }
  refresh();
  window.setInterval(refresh,30000);
})();
