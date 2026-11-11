let selectedNetwork='TRC20';
let investmentCompanies=[];
let depositUserId=null;
let timerHandle=null;
let visibilityPollHandle=null;
let SESSION_KEY='';
const apiToken=()=>localStorage.getItem('safepays_api_token')||'';
const apiHeaders=()=>({'Content-Type':'application/json',Authorization:'Bearer '+apiToken()});
const session=()=>{try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(_){return null}};
function saveSession(v){localStorage.setItem(SESSION_KEY,JSON.stringify(v));}
function clearSession(){if(SESSION_KEY)localStorage.removeItem(SESSION_KEY);if(timerHandle){clearInterval(timerHandle);timerHandle=null;}if(visibilityPollHandle){clearInterval(visibilityPollHandle);visibilityPollHandle=null;}}
function setAmount(v){document.getElementById('amount').value=v;}
function chooseNetwork(network){selectedNetwork=network;document.querySelectorAll('.network-tab').forEach(b=>b.classList.toggle('active',b.dataset.network===network));}
function closeDepositConfirm(){const m=document.getElementById('depositConfirmModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');}}
function openNoWalletModal(message){const modal=document.getElementById('noWalletModal'),text=document.getElementById('noWalletText');if(text)text.textContent=message||'Yatırım işlemi şu anda gerçekleştirilemiyor.';if(modal){modal.classList.add('open');modal.setAttribute('aria-hidden','false');}}
function closeNoWalletModal(){const modal=document.getElementById('noWalletModal');if(modal){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}}
function showPaymentAddress(){
  const amount=Number(document.getElementById('amount').value);
  if(!(amount>=10)){alert('Minimum yatırım 10 USDT.');return;}
  document.getElementById('confirmAmount').textContent=amount.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:8})+' USDT';
  document.getElementById('confirmNetwork').textContent=selectedNetwork;
  const modal=document.getElementById('depositConfirmModal');if(!modal){alert('Onay penceresi yüklenemedi.');return;}modal.classList.add('open');modal.setAttribute('aria-hidden','false');
}
async function loadInvestmentCompanies(){
  try{
    const response=await fetch('/api/investment-companies',{headers:apiHeaders(),cache:'no-store'});
    if(!response.ok)throw new Error('Firmalar yüklenemedi');
    const data=await response.json();investmentCompanies=Array.isArray(data.companies)?data.companies:[];
    const field=document.getElementById('investmentCompanyField'),select=document.getElementById('investmentCompany');
    if(!field||!select)return;
    select.replaceChildren(new Option('Firma seçin',''));
    investmentCompanies.forEach(name=>{const option=document.createElement('option');option.value=name;option.textContent=name;select.appendChild(option);});
    field.hidden=!investmentCompanies.length;
  }catch(_){const field=document.getElementById('investmentCompanyField');if(field)field.hidden=true;}
}
async function confirmDepositStart(){
  closeDepositConfirm();const amount=Number(document.getElementById('amount').value);if(!(amount>=10)){alert('Minimum yatırım 10 USDT.');return;}const companyName=document.getElementById('investmentCompany')?.value.trim()||'';if(investmentCompanies.length&&!companyName){alert('İlgili birim / firma seçin.');return;}
  try{
    const response=await fetch('/api/deposits/prepare',{method:'POST',headers:apiHeaders(),body:JSON.stringify({amount,network:selectedNetwork,companyName})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||({unauthorized:'Oturumunuz sona ermiş. Tekrar giriş yapın.',wallet_unavailable:'Bu ağ için kullanılabilir ödeme adresi yok.',deposits_blocked:'Yatırım işlemleri hesabınız için durdurulmuş.'}[data.error]||'Yatırım adresi alınamadı.'));
    const state={userId:depositUserId,intentId:data.intentId,amount:data.amount,network:data.network,address:data.address,walletId:data.walletId,requireTxId:data.requireTxId!==false,createdAt:Date.parse(data.createdAt),expiresAt:Date.parse(data.expiresAt)};saveSession(state);showPreparedDeposit(state);
  }catch(e){openNoWalletModal(e.message);}
}
function showPreparedDeposit(state){
  selectedNetwork=state.network;document.getElementById('net').textContent=state.network;document.getElementById('addr').textContent=state.address;
  const label=document.querySelector('label[for="txHashInput"]'),hint=document.getElementById('txHashHint');if(label)label.textContent=state.requireTxId===false?"İşlem Hash'i (isteğe bağlı)":"İşlem Hash'i (TX Hash) · zorunlu";if(hint)hint.textContent=state.requireTxId===false?'TX hash girmeden talep oluşturabilirsiniz. Hash eklerseniz ekip işlem kaydında görür.':'Cüzdanınızdaki/borsadaki gönderim işleminin TX hash\'ini (en az 16 karakter) buraya yapıştırın. Bu, ekibimizin ödemenizi doğrulamasını sağlar.';
  document.getElementById('setupCard').style.display='none';document.getElementById('paymentCard').style.display='block';
  document.getElementById('step1dot').classList.add('active');document.getElementById('step2dot').classList.add('active');startTimer(state);if(visibilityPollHandle)clearInterval(visibilityPollHandle);visibilityPollHandle=setInterval(()=>validatePreparedIntent(state),5000);
}
async function validatePreparedIntent(state){
  try{const response=await fetch('/api/deposits/intent-status?intentId='+encodeURIComponent(state.intentId),{headers:apiHeaders(),cache:'no-store'});if(!response.ok)return true;const data=await response.json();if(!data.eligible){await fetch('/api/deposits/intent/cancel',{method:'POST',headers:apiHeaders(),body:JSON.stringify({intentId:state.intentId})}).catch(()=>{});clearSession();document.getElementById('paymentCard').style.display='none';document.getElementById('setupCard').style.display='block';openNoWalletModal('Bu yatırım adresi artık aktif değil. Güvenliğiniz için adres ekrandan kaldırıldı; aktif bir ekip/cüzdan seçerek yeniden başlayın.');return false;}state.requireTxId=data.requireTxId!==false;saveSession(state);const label=document.querySelector('label[for="txHashInput"]'),hint=document.getElementById('txHashHint');if(label)label.textContent=state.requireTxId?"İşlem Hash'i (TX Hash) · zorunlu":"İşlem Hash'i (isteğe bağlı)";if(hint)hint.textContent=state.requireTxId?'Cüzdanınızdaki/borsadaki gönderim işleminin TX hash\'ini (en az 16 karakter) buraya yapıştırın. Bu, ekibimizin ödemenizi doğrulamasını sağlar.':'TX hash girmeden talep oluşturabilirsiniz. Hash eklerseniz ekip işlem kaydında görür.';return true;}catch(_){return true;}
}
function startTimer(state){
  if(timerHandle)clearInterval(timerHandle);
  const tick=()=>{const sec=Math.max(0,Math.ceil((state.expiresAt-Date.now())/1000)),m=Math.floor(sec/60),s=sec%60;const timer=document.getElementById('countdown');if(timer)timer.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');if(sec<=0){clearInterval(timerHandle);timerHandle=null;const btn=document.getElementById('paidBtn');if(btn){btn.disabled=true;btn.textContent='Süre Doldu';}const note=document.getElementById('timerNote');if(note)note.textContent='Ödeme süresi doldu. Yeni bir ödeme adresi alın.';}};
  tick();timerHandle=setInterval(tick,1000);
}
async function confirmPaid(){
  const state=session();if(!state||state.userId!==depositUserId){alert('Aktif ödeme oturumu bulunamadı. Yeni adres alın.');return;}
  if(Date.now()>=state.expiresAt){alert('Ödeme süresi doldu. Yeni adres alın.');clearSession();return;}
  const txHash=String(document.getElementById('txHashInput')?.value||'').trim();if((state.requireTxId!==false&&!txHash)||txHash&&txHash.length<16){alert('Lütfen geçerli bir TX hash girin (en az 16 karakter).');return;}
  const button=document.getElementById('paidBtn');if(button){button.disabled=true;button.textContent='Gönderiliyor…';}
  try{
    const response=await fetch('/api/deposits',{method:'POST',headers:apiHeaders(),body:JSON.stringify({intentId:state.intentId,amount:state.amount,network:state.network,txHash:txHash||undefined})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||({invalid_deposit_intent:'Ödeme adresi süresi dolmuş veya kullanılmış. Yeni adres alın.',duplicate_tx_hash:'Bu işlem hash’i daha önce bildirilmiş.',invalid_tx_hash:'TX hash biçimi geçersiz.',request_cooldown:`Yeni talep için ${data.cooldownSeconds||0} saniye bekleyin.`,unauthorized:'Oturumunuz sona ermiş. Tekrar giriş yapın.'}[data.error]||'Talep sunucuya kaydedilemedi.'));
    document.getElementById('paymentCard').style.display='none';document.getElementById('submittedCard').style.display='block';document.getElementById('submittedId').textContent=data.transaction.id;document.getElementById('step3dot').classList.add('active');clearSession();
  }catch(e){alert(e.message);}
  finally{if(button){button.disabled=false;button.textContent='Ödemeyi Yaptım';}}
}
async function cancelPreparedDeposit(){
  const state=session();if(!state)return;
  if(!confirm('Henüz transfer göndermediyseniz bu adresi kapatıp yatırım akışını iptal edin. Transfer gönderdiyseniz iptal etmeyin. Vazgeçmek istiyor musunuz?'))return;
  try{const response=await fetch('/api/deposits/intent/cancel',{method:'POST',headers:apiHeaders(),body:JSON.stringify({intentId:state.intentId})});if(!response.ok)throw new Error('Yatırım adresi iptal edilemedi.');clearSession();document.getElementById('paymentCard').style.display='none';document.getElementById('setupCard').style.display='block';document.getElementById('txHashInput').value='';document.getElementById('step2dot').classList.remove('active');}catch(e){alert(e.message);}
}
async function initializeDepositPage(){loadInvestmentCompanies();
  const token=apiToken();if(!token){location.replace('login.html');return;}
  try{
    const response=await fetch('/api/auth/me',{headers:apiHeaders(),cache:'no-store'});if(!response.ok)throw new Error('unauthorized');const data=await response.json();depositUserId=String(data.user.id);SESSION_KEY='safepays_deposit_session_'+depositUserId;
    const preferred=new URLSearchParams(location.search).get('network');if(['TRC20','ERC20'].includes(preferred))selectedNetwork=preferred;chooseNetwork(selectedNetwork);
    const saved=session();if(saved&&saved.userId===depositUserId&&saved.expiresAt>Date.now()){const valid=await validatePreparedIntent(saved);if(valid)showPreparedDeposit(saved);}else if(saved)clearSession();
  }catch(_){localStorage.removeItem('safepays_api_token');localStorage.removeItem('safepays_current_user');location.replace('login.html');}
}
window.setAmount=setAmount;window.chooseNetwork=chooseNetwork;window.showPaymentAddress=showPaymentAddress;window.closeDepositConfirm=closeDepositConfirm;window.confirmDepositStart=confirmDepositStart;window.confirmPaid=confirmPaid;window.cancelPreparedDeposit=cancelPreparedDeposit;window.openNoWalletModal=openNoWalletModal;window.closeNoWalletModal=closeNoWalletModal;
document.addEventListener('DOMContentLoaded',initializeDepositPage,{once:true});
