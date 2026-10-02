const reportDate = value => new Date(value).getTime();
const reportMoney = value => Number(value||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:8})+' USDT';
async function refreshReports(){
  const range=Number(document.getElementById('range').value||7),cut=Date.now()-range*86400000;
  try{
    const data=await adminFetch('/transactions');
    const rows=data.transactions||[];
    const period=rows.filter(x=>reportDate(x.createdAt)>=cut);
    const approved=period.filter(x=>x.status==='approved');
    document.getElementById('dep').textContent=reportMoney(approved.filter(x=>x.type==='deposit').reduce((s,x)=>s+Number(x.amount||0),0));
    document.getElementById('wd').textContent=reportMoney(approved.filter(x=>x.type==='withdrawal').reduce((s,x)=>s+Number(x.amount||0),0));
    document.getElementById('cnt').textContent=String(period.length);
    document.getElementById('pend').textContent=String(period.filter(x=>x.status==='pending').length);
  }catch(e){for(const id of ['dep','wd','cnt','pend'])document.getElementById(id).textContent='Veri alınamadı';}
}
document.getElementById('range').addEventListener('change',refreshReports);
refreshReports();
