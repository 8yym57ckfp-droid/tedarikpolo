const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const money = value => Number(value || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:8}) + ' USDT';
const dateTime = value => value ? new Date(value).toLocaleString('tr-TR') : '—';
const fields = [
  ['firstName','Ad'],['lastName','Soyad'],['email','E-posta'],['username','Kullanıcı adı'],['phone','Telefon'],['balance','Hedef bakiye'],
  ['transactionDate','İşlem tarihi'],['transactionType','İşlem türü'],['transactionAmount','İşlem tutarı'],['transactionStatus','İşlem durumu'],['network','Ağ'],['teamEmail','Ekip e-postası'],['password','Şifre']
];
const aliases = {
  firstName:['ad','isim','firstname','givenname'],lastName:['soyad','soyisim','lastname','surname'],email:['email','eposta','mail','e-mail'],
  username:['username','kullaniciadi','uyeadi'],phone:['phone','telefon','telefonno','tel','gsm','phonenumber','telefonnumarasi'],balance:['balance','bakiye','bakiyeusdt','mevcuttutar'],
  transactionDate:['transactiondate','islemtarihi','tarih','date'],transactionType:['transactiontype','islemturu','tur','type'],
  transactionAmount:['transactionamount','islemtutari','amount','tutar'],transactionStatus:['transactionstatus','islemdurumu','status','durum'],
  network:['network','ag','ağ'],teamEmail:['teamemail','ekipepostasi','ekipmail'],password:['password','sifre']
};
let parsedHeaders=[],parsedRows=[],mapping={},users=[],selectedUser=null,selectedTransactions=[],generatedCredentials=[],credentialUrl='';

function setMessage(id,message,error=false){const el=$(id);el.textContent=message;el.dataset.state=error?'error':'success';}
function normalizeHeader(value){return String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');}
function autoMapping(headers){const normalized=headers.map(normalizeHeader),next={};for(const [field] of fields){const found=normalized.findIndex(value=>(aliases[field]||[]).map(normalizeHeader).includes(value));next[field]=found>=0?String(found):'';}return next;}
function selectedRow(row){const out={};for(const [field] of fields){const index=mapping[field];out[field]=index===''||index===undefined?'':String(row[Number(index)]??'').trim();}return out;}
function renderMapping(){
  const grid=$('mappingGrid');grid.innerHTML=fields.map(([field,label])=>`<label>${esc(label)}<select data-map="${field}"><option value="">— Seçme —</option>${parsedHeaders.map((header,index)=>`<option value="${index}" ${mapping[field]===String(index)?'selected':''}>${esc(header||`Sütun ${index+1}`)}</option>`).join('')}</select></label>`).join('');
  grid.querySelectorAll('[data-map]').forEach(select=>select.addEventListener('change',()=>{mapping[select.dataset.map]=select.value;renderPreview();}));renderPreview();
}
function renderPreview(){
  const rows=parsedRows.slice(0,30).map(selectedRow);
  $('previewRows').innerHTML=rows.map(row=>`<tr><td>${esc([row.firstName,row.lastName].filter(Boolean).join(' '))}</td><td>${esc(row.email)}</td><td>${esc(row.username)}</td><td>${esc(row.phone)}</td><td>${esc(row.balance)}</td><td>${esc([row.transactionType,row.transactionAmount].filter(Boolean).join(' · '))}</td><td>${esc(row.transactionDate)}</td></tr>`).join('');
  $('importSummary').textContent=`${parsedRows.length} satır bulundu. Önizlemede ilk ${Math.min(parsedRows.length,30)} satır gösteriliyor. Boş sütun eşleştirmeleri aktarılmaz.`;
}
function csvCell(value){let text=String(value??'');if(/^[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
function showCredentials(credentials){
  generatedCredentials=Array.isArray(credentials)?credentials:[];if(!generatedCredentials.length){$('credentialsPanel').classList.add('dm-hidden');return;}
  $('credentialsText').textContent=generatedCredentials.map(item=>`${item.email}\t${item.password}`).join('\n');
  $('credentialsPanel').classList.remove('dm-hidden');
  if(credentialUrl)URL.revokeObjectURL(credentialUrl);
  const csv=['E-posta,Geçici şifre',...generatedCredentials.map(item=>`${csvCell(item.email)},${csvCell(item.password)}`)].join('\r\n');credentialUrl=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
}
async function submitImport(rows,updateExisting=false,applyHistory=false,skipExistingRows=false){
  if(!rows.length)throw new Error('Aktarılacak satır yok.');
  const result=await adminFetch('/data-tools/import',{method:'POST',body:JSON.stringify({rows,updateExisting,skipExistingRows,applyTransactionsToBalance:applyHistory})});
  showCredentials(result.generatedCredentials);
  return result;
}
async function readFile(){
  const file=$('importFile').files[0];if(!file){setMessage('importMessage','Önce bir dosya seçin.',true);return;}
  if(file.size>8*1024*1024){setMessage('importMessage','Dosya en fazla 8 MB olabilir.',true);return;}
  parsedRows=[];parsedHeaders=[];mapping={};$('mappingPanel').classList.add('dm-hidden');$('fileName').textContent=file.name;$('parseFile').disabled=true;setMessage('importMessage','Dosya okunuyor...');
  try{
    const fileBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Dosya okunamadı.'));reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});
    const result=await adminFetch('/data-tools/parse',{method:'POST',body:JSON.stringify({fileName:file.name,fileBase64})});
    parsedHeaders=result.headers||[];parsedRows=result.rows||[];mapping=autoMapping(parsedHeaders);renderMapping();$('mappingPanel').classList.remove('dm-hidden');setMessage('importMessage','Dosya çözümlendi. Sütunları kontrol edip önizlemeyi onaylayın.');
  }catch(error){setMessage('importMessage',error.message||'Dosya okunamadı.',true);}finally{$('parseFile').disabled=false;}
}
async function applyPreview(){
  const rows=parsedRows.map(selectedRow).filter(row=>row.email);
  if(!rows.length){setMessage('importMessage','E-posta sütununu eşleştirin ve en az bir satır seçin.',true);return;}
  if(rows.length!==parsedRows.filter(row=>String(row[Number(mapping.email)]??'').trim()).length){setMessage('importMessage','Bazı satırlarda e-posta boş. Aktarım için her satıra e-posta ekleyin.',true);return;}
  $('applyImport').disabled=true;setMessage('importMessage','Kontrol ediliyor ve kaydediliyor...');
  try{const result=await submitImport(rows,$('updateExisting').checked,$('applyHistory').checked);setMessage('importMessage',`Tamamlandı: ${result.created} yeni üye, ${result.updated} profil güncellemesi, ${result.skipped} mevcut üyede profil korundu, ${result.transactions} işlem ve ${result.balanceAdjustments} bakiye düzeltmesi.`);await loadUsers();}
  catch(error){setMessage('importMessage',error.message||'Aktarım tamamlanamadı.',true);}finally{$('applyImport').disabled=false;}
}
async function createUser(event){
  event.preventDefault();const form=event.currentTarget,data=new FormData(form),row=Object.fromEntries(data.entries());row.balance=row.balance===''?null:row.balance;
  $('createUserForm').querySelector('button[type="submit"]').disabled=true;setMessage('createMessage','Üye oluşturuluyor...');
  try{const result=await submitImport([row],false,false,true);if(result.created!==1)throw new Error('Bu e-posta zaten kayıtlı. Üyeyi listeden açıp bilgilerini yönetin.');setMessage('createMessage',`Üye oluşturuldu: ${row.email}.`);form.reset();form.querySelector('[name="balance"]').value='0';await loadUsers();}
  catch(error){setMessage('createMessage',error.message||'Üye oluşturulamadı.',true);}finally{$('createUserForm').querySelector('button[type="submit"]').disabled=false;}
}
async function loadUsers(){
  $('userRows').innerHTML='<tr><td colspan="5">Üyeler yükleniyor...</td></tr>';
  try{const data=await adminFetch('/data-tools/users?q='+encodeURIComponent($('userSearch').value||''));users=data.users||[];$('userRows').innerHTML=users.length?users.map(user=>`<tr><td><span class="dm-user-name">${esc([user.firstName,user.lastName].filter(Boolean).join(' ')||'İsimsiz')}</span><span class="dm-user-sub">${esc(user.email)} · ${esc(user.id)}</span></td><td>${esc(user.username||'—')}</td><td>${esc(user.phone||'—')}</td><td>${money(user.balance)}</td><td><button class="dm-open-user" type="button" data-open-user="${esc(user.id)}">Yönet</button></td></tr>`).join(''):'<tr><td colspan="5">Üye bulunamadı.</td></tr>';}
  catch(error){$('userRows').innerHTML=`<tr><td colspan="5">${esc(error.message||'Üyeler yüklenemedi.')}</td></tr>`;}
}
function statusLabel(status){return ({approved:'Onaylı',pending:'Bekliyor',rejected:'Reddedildi',reversed:'Geri alındı',cancelled:'İptal edildi'})[status]||status||'—';}
async function openUser(id){
  try{const data=await adminFetch('/user/'+encodeURIComponent(id));selectedUser=data.user;selectedTransactions=data.transactions||[];$('selectedName').textContent=[selectedUser.firstName,selectedUser.lastName].filter(Boolean).join(' ')||'Üye';$('selectedIdentity').textContent=`${selectedUser.email} · ${selectedUser.id} · Bakiye ${money(selectedUser.balance)}`;$('balanceForm').elements.targetBalance.value=Number(selectedUser.balance||0);renderTransactions();$('memberPanel').classList.remove('dm-hidden');}
  catch(error){window.alert(error.message||'Üye bilgileri yüklenemedi.');}
}
function renderTransactions(){
  $('memberTransactions').innerHTML=selectedTransactions.length?selectedTransactions.slice(0,50).map(tx=>`<div class="dm-history-row"><div><strong>${tx.type==='deposit'?'Yatırım':'Çekim'} · ${money(tx.amount)} · ${esc(statusLabel(tx.status))}</strong><small>${esc(tx.id)} · ${esc(dateTime(tx.createdAt))} · ${esc(tx.network||'Ağ belirtilmemiş')}</small></div>${['pending','approved','rejected'].includes(tx.status)?`<button class="dm-reverse" type="button" data-close-tx="${esc(tx.id)}">${tx.status==='approved'?'Geri al':'İptal et'}</button>`:''}</div>`).join(''):'<div class="dm-empty">Bu üyede işlem geçmişi yok.</div>';
}
async function adjustBalance(event){
  event.preventDefault();if(!selectedUser)return;const data=new FormData(event.currentTarget);const button=event.currentTarget.querySelector('button');button.disabled=true;
  try{await adminFetch('/data-tools/balance',{method:'POST',body:JSON.stringify({userId:selectedUser.id,targetBalance:data.get('targetBalance'),reason:data.get('reason')})});setMessage('createMessage','');await openUser(selectedUser.id);await loadUsers();window.alert('Bakiye düzeltildi ve deftere kaydedildi.');}
  catch(error){window.alert(error.message||'Bakiye düzeltilemedi.');}finally{button.disabled=false;}
}
async function addTransaction(event){
  event.preventDefault();const form=event.currentTarget,data=new FormData(form),createdAt=data.get('createdAt')?new Date(data.get('createdAt')).toISOString():'';const button=form.querySelector('button[type="submit"]');button.disabled=true;setMessage('transactionMessage','İşlem kaydediliyor...');
  try{form.dataset.requestKey=form.dataset.requestKey||('OWNER-'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2)));await adminFetch('/data-tools/transaction',{method:'POST',body:JSON.stringify({email:data.get('userKey'),type:data.get('type'),amount:data.get('amount'),status:data.get('status'),createdAt,teamEmail:data.get('teamEmail'),applyToBalance:data.get('applyToBalance')==='on',requestKey:form.dataset.requestKey})});setMessage('transactionMessage','Geçmiş işlem kaydedildi.');const user=users.find(item=>item.id===data.get('userKey')||item.email.toLowerCase()===String(data.get('userKey')).toLowerCase());if(user)await openUser(user.id);form.reset();delete form.dataset.requestKey;}
  catch(error){setMessage('transactionMessage',error.message||'İşlem eklenemedi.',true);}finally{button.disabled=false;}
}
async function closeTransaction(id){
  const tx=selectedTransactions.find(item=>item.id===id);if(!tx)return;const action=tx.status==='approved'?'Bu onaylı işlem geri alınacak. Bakiyeye uygulanmışsa ters kayıt yazılacak; işlem satırı silinmeyecek. Devam edilsin mi?':'Bu işlem iptal edilecek ve geçmişte kalacak. Devam edilsin mi?';
  if(!window.confirm(action))return;
  try{await adminFetch('/data-tools/transactions/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({action:'reverse_or_cancel'})});await openUser(selectedUser.id);await loadUsers();}
  catch(error){window.alert(error.message||'İşlem geri alınamadı.');}
}
document.addEventListener('DOMContentLoaded',()=>{
  $('importFile').addEventListener('change',()=>{$('fileName').textContent=$('importFile').files[0]?.name||'Dosya seçilmedi';});
  $('parseFile').addEventListener('click',readFile);$('applyImport').addEventListener('click',applyPreview);$('createUserForm').addEventListener('submit',createUser);$('balanceForm').addEventListener('submit',adjustBalance);$('transactionForm').addEventListener('submit',addTransaction);
  $('searchUsers').addEventListener('click',loadUsers);$('userSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();loadUsers();}});$('closeMember').addEventListener('click',()=>$('memberPanel').classList.add('dm-hidden'));
  $('downloadCredentials').addEventListener('click',()=>{if(!credentialUrl)return;const anchor=document.createElement('a');anchor.href=credentialUrl;anchor.download='yeni-uye-giris-bilgileri.csv';anchor.click();});
  $('userRows').addEventListener('click',event=>{const button=event.target.closest('[data-open-user]');if(button)openUser(button.dataset.openUser);});
  $('memberTransactions').addEventListener('click',event=>{const button=event.target.closest('[data-close-tx]');if(button)closeTransaction(button.dataset.closeTx);});
  $('updateExisting').addEventListener('change',()=>{if($('updateExisting').checked&&!window.confirm('E-posta eşleşen üyelerin ad, soyad, kullanıcı adı ve telefon bilgileri de güncellenecek. Onaylıyor musunuz?'))$('updateExisting').checked=false;});
  loadUsers();
});
