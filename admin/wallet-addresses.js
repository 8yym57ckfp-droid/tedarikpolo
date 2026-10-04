const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' USDT';
const date=v=>v?new Date(v).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let wallets=[],transactions=[],users=[],teamAccounts=[];
const ownerView=location.pathname.includes('/owner/');

async function loadWalletData(){
  const tasks=[
    adminFetch('/wallet-addresses'),
    adminFetch('/transactions'),
    adminFetch('/users')
  ];
  if(ownerView)tasks.push(adminFetch('/team-accounts'));
  const [w,t,u,teams]=await Promise.allSettled(tasks);
  if(w.status==='rejected')throw w.reason;
  wallets=w.value.wallets||[];
  transactions=t.status==='fulfilled'?(t.value.transactions||[]):[];
  users=u.status==='fulfilled'?(u.value.users||[]):[];
  teamAccounts=ownerView&&teams?.status==='fulfilled'?(teams.value.accounts||[]):[];
  const teamSelect=$('teamAssign');
  if(teamSelect){const selected=teamSelect.value;teamSelect.innerHTML='<option value="">Sahipsiz / ortak rotasyon</option>'+teamAccounts.map(team=>`<option value="${esc(team.id)}">${esc(team.email)}${team.walletLimit?` · ${team.walletLimit} cüzdan sınırı`:''}</option>`).join('');teamSelect.value=teamAccounts.some(team=>team.id===selected)?selected:'';}
  renderWalletData();
  const msg=$('loadMsg');
  if(msg&&(t.status==='rejected'||u.status==='rejected')){
    const failed=[t.status==='rejected'?'işlem özeti':'',u.status==='rejected'?'üye özeti':''].filter(Boolean).join(' ve ');
    msg.textContent=`Cüzdanlar yüklendi; ${failed} alınamadı.`;
    msg.style.color='#b7791f';
  }
}
function renderWalletData(){
  $('totalIn').classList.add('amount-deposit');$('totalOut').classList.add('amount-withdrawal');
  $('trcActive').textContent=wallets.filter(w=>w.network==='TRC20'&&w.active).length;
  $('ercActive').textContent=wallets.filter(w=>w.network==='ERC20'&&w.active).length;
  $('totalIn').textContent=fmt(transactions.filter(x=>x.type==='deposit'&&x.status==='approved').reduce((s,x)=>s+Number(x.amount||0),0));
  $('totalOut').textContent=fmt(transactions.filter(x=>x.type==='withdrawal'&&x.status==='approved').reduce((s,x)=>s+Number(x.amount||0),0));
  $('walletRows').innerHTML=wallets.map(w=>{
    const tx=transactions.filter(x=>x.walletId===w.id),ins=tx.filter(x=>x.type==='deposit'&&x.status==='approved').reduce((s,x)=>s+Number(x.amount||0),0),outs=tx.filter(x=>x.type==='withdrawal'&&x.status==='approved').reduce((s,x)=>s+Number(x.amount||0),0),net=ins-outs;
    const teamCell=ownerView?`<select class="wallet-team-select" aria-label="${esc(w.label)} ekibini seç" onchange="assignWalletTeam('${esc(w.id)}',this.value)"><option value="">Ortak</option>${teamAccounts.map(team=>`<option value="${esc(team.id)}" ${team.id===w.teamId?'selected':''}>${esc(team.email)}</option>`).join('')}</select>`:'';
    return `<tr><td><span class="label">${esc(w.label)}</span><span class="sub">${esc(w.id)}</span></td><td><span class="network ${w.network==='TRC20'?'trc':'erc'}">${esc(w.network)}</span></td><td><div class="address">${esc(w.address)}</div></td>${ownerView?`<td>${teamCell}</td>`:''}<td><span class="badge ${w.active?'on':'off'}">● ${w.active?'Aktif':'Pasif'}</span></td><td><b>${Number(w.useCount||0)}</b></td><td class="money amount-deposit">${fmt(ins)}</td><td class="money amount-withdrawal">${fmt(outs)}</td><td class="money amount-cash ${net>=0?'netpos':'netneg'}">${fmt(net)}</td><td>${date(w.lastUsedAt)}</td><td class="actions"><button class="mini toggle" onclick="toggleWallet('${esc(w.id)}',${!w.active})">${w.active?'Pasif Yap':'Aktif Yap'}</button><button class="mini edit" onclick="editWallet('${esc(w.id)}')">Düzenle</button><button class="mini del" onclick="removeWallet('${esc(w.id)}')">Sil</button></td></tr>`;
  }).join('')||`<tr><td colspan="${ownerView?11:10}" class="empty">Henüz yatırım adresi eklenmedi.</td></tr>`;
  const userById=new Map(users.map(u=>[u.id,u])),groups={};
  transactions.forEach(x=>{const u=userById.get(x.userId)||{};groups[x.userId]??={userId:x.userId,name:[u.firstName,u.lastName].filter(Boolean).join(' '),email:u.email||'',deposits:0,withdrawals:0,last:null};if(x.status==='approved'){if(x.type==='deposit')groups[x.userId].deposits+=Number(x.amount||0);else if(x.type==='withdrawal')groups[x.userId].withdrawals+=Number(x.amount||0);}if(!groups[x.userId].last||new Date(x.createdAt)>new Date(groups[x.userId].last))groups[x.userId].last=x.createdAt;});
  $('userRows').innerHTML=Object.values(groups).sort((a,b)=>b.deposits+b.withdrawals-a.deposits-a.withdrawals).map(g=>`<tr><td><span class="user-name">${esc(g.name||g.userId)}</span><span class="user-sub">${esc(g.userId)}</span></td><td>${esc(g.email||'—')}</td><td class="money amount-deposit">${fmt(g.deposits)}</td><td class="money amount-withdrawal">${fmt(g.withdrawals)}</td><td class="money amount-cash ${g.deposits-g.withdrawals>=0?'netpos':'netneg'}">${fmt(g.deposits-g.withdrawals)}</td><td>${date(g.last)}</td><td><a class="mini edit" href="user-detail.html?id=${encodeURIComponent(g.userId)}">İncele</a></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Henüz finansal işlem yok.</td></tr>';
}
async function addAddress(){
  const button=document.querySelector('.add-grid button');button.disabled=true;
  try{const data=await adminFetch('/wallet-addresses',{method:'POST',body:JSON.stringify({action:'add',network:$('newNetwork').value,label:$('newLabel').value.trim(),address:$('newAddress').value.trim(),active:$('newActive').checked,teamId:$('teamAssign')?.value||null})});$('msg').textContent=data.wallet.network+' adresi sunucuya kaydedildi.';$('msg').style.color='#138654';$('newLabel').value='';$('newAddress').value='';if($('teamAssign'))$('teamAssign').value='';await refreshWalletDataAfterWrite();}
  catch(e){$('msg').textContent=e.message==='wallet_exists'?'Bu ağ ve adres zaten kayıtlı.':e.message==='invalid_address'?'Adres biçimi seçilen ağla uyuşmuyor.':e.message==='team_wallet_limit_reached'?'Bu ekibin cüzdan sınırına ulaşıldı.':'Kayıt yapılamadı: '+e.message;$('msg').style.color='#d74754';}
  finally{button.disabled=false;}
}
async function refreshWalletDataAfterWrite(){try{await loadWalletData()}catch(e){const msg=$('loadMsg');if(msg){msg.textContent='İşlem kaydedildi; cüzdan listesi yenilenemedi: '+e.message;msg.style.color='#b7791f';}}}
async function updateWallet(id,payload){await adminFetch('/wallet-addresses',{method:'POST',body:JSON.stringify({action:'update',id,...payload})});await refreshWalletDataAfterWrite();}
async function assignWalletTeam(id,teamId){try{await updateWallet(id,{teamId:teamId||null});const msg=$('msg');if(msg){msg.textContent='Cüzdan ekibi güncellendi.';msg.style.color='#138654';}}catch(error){alert(error.message==='team_wallet_limit_reached'?'Bu ekibin cüzdan sınırına ulaşıldı.':'Cüzdan ekibi güncellenemedi: '+error.message);await loadWalletData().catch(()=>{});}}
async function toggleWallet(id,active){try{await updateWallet(id,{active});}catch(e){alert('Adres durumu güncellenemedi: '+e.message);}}
async function editWallet(id){const w=wallets.find(x=>x.id===id);if(!w)return;const label=prompt('Hesap adı:',w.label);if(label===null)return;const address=prompt('Cüzdan adresi:',w.address);if(address===null)return;try{await updateWallet(id,{label:label.trim(),address:address.trim()});}catch(e){alert('Adres güncellenemedi: '+e.message);}}
async function removeWallet(id){const w=wallets.find(x=>x.id===id);if(!w||!confirm(`${w.label} kaldırılsın mı? Geçmiş işlemlerde kullanılan adres pasif yapılır.`))return;try{await adminFetch('/wallet-addresses',{method:'POST',body:JSON.stringify({action:'delete',id})});await refreshWalletDataAfterWrite();}catch(e){alert('Adres kaldırılamadı: '+e.message);}}
window.addAddress=addAddress;window.toggleWallet=toggleWallet;window.editWallet=editWallet;window.removeWallet=removeWallet;window.assignWalletTeam=assignWalletTeam;
loadWalletData().catch(e=>{const msg=$('msg');if(msg){msg.textContent='Sunucu verileri yüklenemedi: '+e.message;msg.style.color='#d74754';}});
setInterval(()=>loadWalletData().catch(()=>{}),15000);
