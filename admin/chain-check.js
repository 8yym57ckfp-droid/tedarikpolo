(function(){
  const text=id=>document.getElementById(id)?.textContent?.trim()||'';
  const messages={
    confirmed_transfer:'Zincirde doğru ağ, alıcı ve tutar ile kesinleşmiş USDT transferi bulundu.',
    transaction_not_solidified:'TRON işlemi henüz kesinleşmedi. Biraz sonra yeniden kontrol edin.',
    execution_status_unavailable:'Ağ işleminin sonucu henüz doğrulanamadı.',
    transaction_not_mined:'Ethereum işlemi henüz bloğa alınmadı.',
    transaction_not_finalized:'Ethereum işlemi henüz kesinleşmedi. Biraz sonra yeniden kontrol edin.',
    transaction_failed:'Zincir işlemi başarısız olmuş.',
    usdt_transfer_not_found:'İşlemde resmi USDT transferi bulunamadı.',
    recipient_mismatch:'USDT transferi bu talepteki adrese yapılmamış.',
    amount_mismatch:'Zincirdeki USDT tutarı talep tutarıyla uyuşmuyor.',
    wrong_chain:'Bu işlem Ethereum ana ağında değil.',
    ethereum_rpc_not_configured:'Ethereum doğrulaması için Render’da ETHEREUM_RPC_URL yapılandırılmalı.',
    provider_timeout:'Blokzincir sağlayıcısı zaman aşımına uğradı. Yeniden deneyin.',
    provider_unavailable:'Blokzincir sağlayıcısına şu anda ulaşılamıyor.',
    provider_response_error:'Blokzincir sağlayıcısından okunabilir bir yanıt alınamadı.',
    provider_http_429:'Sağlayıcı istek sınırına ulaşıldı. Biraz sonra deneyin.',
    invalid_tx_hash:'İşlem kimliği biçimi bu ağa uygun değil.',
    invalid_tron_address:'Kayıtlı TRON adresi doğrulanamadı.',
    invalid_usdt_amount:'Tutar USDT’nin 6 ondalık hassasiyetine uygun değil.'
  };
  let wrapperInstalled=false;

  function installPanel(){
    const hashBlock=document.getElementById('dHash')?.parentElement?.parentElement;
    if(!hashBlock)return;
    let panel=document.getElementById('chainCheckPanel');
    if(!panel){
      panel=document.createElement('section');
      panel.id='chainCheckPanel';
      panel.className='chain-check-panel';
      panel.innerHTML='<div class="chain-check-title">Blokzincir kontrolü</div><label class="chain-check-label" for="chainCheckHash">Çekim gönderim işlem kimliği</label><input id="chainCheckHash" class="chain-check-input" spellcheck="false" autocomplete="off" placeholder="TRON: 64 hex · Ethereum: 0x + 64 hex"><button id="chainCheckButton" type="button">Zincirde kontrol et</button><div id="chainCheckResult" class="chain-check-result" aria-live="polite">Kontrol, bakiyeyi değiştirmez ve talebi otomatik onaylamaz.</div><a id="chainCheckExplorer" class="chain-check-explorer" target="_blank" rel="noopener noreferrer" hidden>Blokzincir gezgininde aç</a>';
      hashBlock.parentElement.insertBefore(panel,hashBlock.parentElement.nextSibling);
      const style=document.createElement('style');
      style.textContent='.chain-check-panel{margin:12px 0;padding:14px;border:1px solid #245074;border-radius:12px;background:#0b2037;color:#e7f1fc}.chain-check-title{font-size:13px;font-weight:900;margin-bottom:8px}.chain-check-label{display:block;color:#9bb1c9;font-size:11px;margin:8px 0 5px}.chain-check-input{display:block;width:100%;box-sizing:border-box;height:38px;padding:0 10px;border:1px solid #2b5276;border-radius:8px;background:#071527;color:#eef6ff}.chain-check-panel button{margin-top:9px;padding:9px 12px;border:0;border-radius:8px;background:#1478d4;color:#fff;font-weight:800;cursor:pointer}.chain-check-panel button:disabled{opacity:.6;cursor:wait}.chain-check-result{margin-top:9px;color:#9bb1c9;font-size:11px;line-height:1.5}.chain-check-explorer{display:inline-block;margin-top:7px;color:#67b8ff;font-size:11px}.chain-check-panel.is-verified .chain-check-result{color:#64e0a9}.chain-check-panel.is-mismatch .chain-check-result{color:#ff8995}';
      document.head.appendChild(style);
      panel.querySelector('#chainCheckButton').addEventListener('click',verifyCurrent);
    }
    const type=text('dType');
    const isWithdrawal=type==='Çekim';
    const label=panel.querySelector('.chain-check-label');
    const input=panel.querySelector('#chainCheckHash');
    label.hidden=!isWithdrawal;
    input.hidden=!isWithdrawal;
    if(isWithdrawal)input.value='';
    panel.classList.remove('is-verified','is-mismatch');
    panel.querySelector('#chainCheckResult').textContent='Kontrol, bakiyeyi değiştirmez ve talebi otomatik onaylamaz.';
    panel.querySelector('#chainCheckExplorer').hidden=true;
  }

  function reasonMessage(reason,network){
    if(reason==='invalid_tx_hash')return network==='TRC20'
      ?'TRC20 TX ID, 64 hexadecimal karakterden oluşmalı. Cüzdan adresini değil transfer işlem kimliğini girin.'
      :'ERC20 TX ID, 0x + 64 hexadecimal karakter olmalı. Cüzdan adresini değil transfer işlem kimliğini girin.';
    return messages[reason]||`Kontrol sonucu: ${reason||'bilinmiyor'}.`;
  }

  function explorerUrl(network,hash){
    const clean=String(hash||'').trim();
    if(network==='TRC20'&&/^[a-f0-9]{64}$/i.test(clean))return `https://tronscan.org/#/transaction/${encodeURIComponent(clean)}`;
    if(network==='ERC20'&&/^0x[a-f0-9]{64}$/i.test(clean))return `https://etherscan.io/tx/${encodeURIComponent(clean)}`;
    return '';
  }

  async function verifyCurrent(){
    const button=document.getElementById('chainCheckButton');
    const resultBox=document.getElementById('chainCheckResult');
    const explorer=document.getElementById('chainCheckExplorer');
    const panel=document.getElementById('chainCheckPanel');
    const transactionId=text('dId');
    const network=text('dNetwork');
    const isWithdrawal=text('dType')==='Çekim';
    const txHash=isWithdrawal?document.getElementById('chainCheckHash').value.trim():'';
    const amount=Number(document.getElementById('decisionAmount')?.value||0);
    button.disabled=true;resultBox.textContent='Ağ kaydı okunuyor…';panel.classList.remove('is-verified','is-mismatch');explorer.hidden=true;
    try{
      const data=await adminFetch('/transactions/verify-chain',{method:'POST',body:JSON.stringify({transactionId,txHash,amount})});
      const check=data.verification||{};
      resultBox.textContent=reasonMessage(check.reason,network);
      if(check.status==='verified')panel.classList.add('is-verified');
      if(check.status==='mismatch')panel.classList.add('is-mismatch');
      const link=explorerUrl(network,check.txHash||(isWithdrawal?txHash:text('dHash')));
      if(link){explorer.href=link;explorer.hidden=false;}
      if(check.status==='verified')resultBox.textContent+=' Admin onayı yine gereklidir.';
    }catch(error){
      resultBox.textContent=messages[error.message]||'Zincir kontrolü tamamlanamadı. Dış cüzdan gezgininden manuel kontrol edebilirsiniz.';
      const link=explorerUrl(network,isWithdrawal?txHash:text('dHash'));
      if(link){explorer.href=link;explorer.hidden=false;}
    }finally{button.disabled=false;}
  }

  if(!wrapperInstalled&&typeof window.openDrawer==='function'){
    wrapperInstalled=true;
    const original=window.openDrawer;
    window.openDrawer=function(){original.apply(this,arguments);installPanel();};
  }
})();
