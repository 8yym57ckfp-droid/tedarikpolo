const supportToken=()=>localStorage.getItem('safepays_api_token')||'';
const supportHeaders=()=>({'Content-Type':'application/json',Authorization:'Bearer '+supportToken()});
const supportEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activeTicket=null,supportSubject='Genel hesap desteği';
async function supportRequest(url,options={}){const r=await fetch(url,{...options,headers:{...supportHeaders(),...(options.headers||{})},cache:'no-store'});const d=await r.json().catch(()=>({}));if(r.status===401)throw new Error('unauthorized');if(!r.ok)throw new Error(d.message||d.error||'request_failed');return d;}
function setSupportChatVisible(show){const panel=document.getElementById('supportChatPanel'),list=document.getElementById('supportList'),ctx=document.getElementById('supportContext'),shell=document.getElementById('supportShell');if(panel)panel.hidden=!show;if(list)list.hidden=show;if(ctx)ctx.hidden=show;shell?.classList.toggle('chat-open',show);}
function renderSupportTicket(ticket){
  activeTicket=ticket;const title=document.getElementById('supportTicketTitle');if(title)title.textContent=ticket?.subject||supportSubject;
  const status=document.querySelector('#supportChatPanel .agent-status');if(status)status.textContent=ticket?.status==='closed'?'Talep kapalı':'Talep destek ekibine iletildi';
  const box=document.getElementById('supportMessages');if(!box)return;
  const messages=ticket?.messages||[];box.innerHTML=messages.map(m=>`<div class="bubble ${m.senderRole==='user'?'me':''}"><span class="bubble-label">${m.senderRole==='user'?'SİZ':'DESTEK EKİBİ'} · ${new Date(m.createdAt).toLocaleString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>${supportEsc(m.message)}</div>`).join('');
  if(!messages.length){const note=document.createElement('div');note.className='bubble';note.textContent='Mesajınız bu ekrandan destek ekibine kayıt olarak iletilir. Yanıt geldiğinde aynı konuşmada görünür.';box.appendChild(note);}
  box.scrollTop=box.scrollHeight;
}
function openSupportChat(title,description){supportSubject=String(title||'Genel destek').trim();setSupportChatVisible(true);const desc=document.getElementById('supportTicketDescription');if(desc)desc.textContent=description||'';if(activeTicket)renderSupportTicket(activeTicket);else renderSupportTicket(null);setTimeout(()=>document.getElementById('chatInput')?.focus(),50);}
function closeSupportChat(){setSupportChatVisible(false);}
function requestHuman(){openSupportChat('İnsan desteği talebi','Mesajınız destek ekibine kalıcı destek talebi olarak iletilir.');}
function quickAsk(text){const input=document.getElementById('chatInput');if(input){input.value=String(text||'');sendSupportMessage();}}
async function sendSupportMessage(){
  const input=document.getElementById('chatInput'),text=String(input?.value||'').trim();if(!text)return;
  const button=document.querySelector('.support-compose button[onclick="sendSupportMessage()"]');if(button)button.disabled=true;
  try{
    const d=activeTicket?await supportRequest(`/api/support/tickets/${encodeURIComponent(activeTicket.id)}/messages`,{method:'POST',body:JSON.stringify({message:text})}):await supportRequest('/api/support/tickets',{method:'POST',body:JSON.stringify({subject:supportSubject,message:text})});
    if(input)input.value='';if(d.ticket)renderSupportTicket(d.ticket);else{activeTicket.updatedAt=d.message.createdAt;activeTicket.messages=[...(activeTicket.messages||[]),d.message];renderSupportTicket(activeTicket);}
  }catch(e){if(e.message==='unauthorized'){location.replace('login.html');return;}alert('Mesaj destek talebine kaydedilemedi: '+e.message);}
  finally{if(button)button.disabled=false;}
}
async function searchSupportTx(){
  const search=String(document.getElementById('txSearch')?.value||'').trim().toLowerCase(),out=document.getElementById('txResult');if(!search||!out)return;
  try{const d=await supportRequest('/api/transactions'),tx=(d.transactions||[]).find(x=>String(x.id||'').toLowerCase()===search||String(x.txHash||'').toLowerCase()===search);if(!tx){out.innerHTML='<div class="support-note">Bu hesapta eşleşen işlem bulunamadı.</div>';return;}
    const state={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi','auto-rejected':'Süresi doldu'}[tx.status]||tx.status;
    out.innerHTML=`<div class="context-card"><div class="label">${tx.type==='deposit'?'Yatırım':'Çekim'} · ${supportEsc(tx.id)}</div><div class="value">${Number(tx.amount||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:8})} USDT</div><div class="sub">${supportEsc(tx.network||'—')} · ${supportEsc(state)}</div></div><div class="timeline-row"><b>Talep zamanı</b><br>${new Date(tx.createdAt).toLocaleString('tr-TR')}</div><div class="timeline-row"><b>TX hash / adres</b><br>${supportEsc(tx.txHash||tx.address||'—')}</div>`;
  }catch(e){if(e.message==='unauthorized'){location.replace('login.html');return;}out.textContent='İşlem bilgisi alınamadı.';}
}
async function loadSupport(){
  if(!supportToken()){location.replace('login.html');return;}
  try{
    const [me,tickets]=await Promise.all([supportRequest('/api/auth/me'),supportRequest('/api/support/tickets')]),user=me.user||{};
    const balance=document.getElementById('supportBalance');if(balance)balance.textContent=Number(user.balance||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' USDT';
    const pending=(await supportRequest('/api/transactions')).transactions.filter(x=>x.status==='pending');const pendingTotal=pending.reduce((n,x)=>n+Number(x.amount||0),0);const pendingEl=document.getElementById('supportPending');if(pendingEl)pendingEl.textContent=pending.length?`${pending.length} bekleyen · ${pendingTotal.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} USDT`:'Bekleyen işlem yok';
    const ticket=(tickets.tickets||[]).find(t=>t.status==='open');if(ticket){if(activeTicket?.id===ticket.id){const latest=await supportRequest(`/api/support/tickets/${encodeURIComponent(ticket.id)}`);renderSupportTicket(latest.ticket);}else if(!activeTicket){activeTicket=ticket;supportSubject=ticket.subject;}}
  }catch(e){if(e.message==='unauthorized'){localStorage.removeItem('safepays_api_token');location.replace('login.html');}}
}
window.openSupportChat=openSupportChat;window.closeSupportChat=closeSupportChat;window.requestHuman=requestHuman;window.sendSupportMessage=sendSupportMessage;window.searchSupportTx=searchSupportTx;window.quickAsk=quickAsk;
document.addEventListener('DOMContentLoaded',async()=>{await loadSupport();setInterval(loadSupport,15000);},{once:true});
