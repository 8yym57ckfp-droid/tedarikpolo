const el=id=>document.getElementById(id);
const supportEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let supportTickets=[],selectedTicketId=null;
function renderTicketList(){
  const host=el('ticketList');host.innerHTML=supportTickets.map(t=>{const name=[t.firstName||t.user?.firstName,t.lastName||t.user?.lastName].filter(Boolean).join(' ')||t.userId;return `<button class="ticket-item ${t.id===selectedTicketId?'active':''}" onclick="selectTicket('${supportEsc(t.id)}')"><strong>${supportEsc(t.subject)}</strong><small>${supportEsc(name)} · ${supportEsc(t.email||t.user?.email||'')} · ${new Date(t.updatedAt).toLocaleString('tr-TR')}</small><small>${supportEsc(t.status)} · ${(t.messages||[]).length} mesaj</small></button>`}).join('')||'<div class="empty">Henüz destek talebi yok.</div>';
}
function renderThread(ticket){
  if(!ticket){el('threadTitle').textContent='Bir talep seçin';el('threadMeta').textContent='';el('threadMessages').innerHTML='<div class="empty">Mesajlar burada görüntülenir.</div>';return;}
  el('threadTitle').textContent=ticket.subject;el('threadMeta').textContent=`${ticket.user?.firstName||ticket.firstName||''} ${ticket.user?.lastName||ticket.lastName||''} · ${ticket.email||ticket.user?.email||ticket.userId} · ${ticket.status}`;
  el('threadMessages').innerHTML=(ticket.messages||[]).map(m=>`<div class="thread-message ${m.senderRole==='admin'?'admin':''}"><small>${m.senderRole==='admin'?'Destek ekibi':'Üye'} · ${new Date(m.createdAt).toLocaleString('tr-TR')}</small><br>${supportEsc(m.message)}</div>`).join('')||'<div class="empty">Mesaj yok.</div>';el('threadMessages').scrollTop=el('threadMessages').scrollHeight;
}
async function loadTickets(){try{const d=await adminFetch('/support/tickets');supportTickets=d.tickets||[];if(!supportTickets.some(t=>t.id===selectedTicketId))selectedTicketId=supportTickets[0]?.id||null;renderTicketList();renderThread(supportTickets.find(t=>t.id===selectedTicketId)||null);}catch(e){el('ticketList').innerHTML='<div class="empty">Talepler alınamadı: '+supportEsc(e.message)+'</div>';}}
function selectTicket(id){selectedTicketId=id;renderTicketList();renderThread(supportTickets.find(t=>t.id===id)||null);el('supportMessage').textContent='';}
async function sendReply(){
  const ticket=supportTickets.find(t=>t.id===selectedTicketId),message=el('replyText').value.trim();if(!ticket||!message)return;
  try{await adminFetch(`/support/tickets/${encodeURIComponent(ticket.id)}/messages`,{method:'POST',body:JSON.stringify({message})});el('replyText').value='';el('supportMessage').textContent='Yanıt kaydedildi.';await loadTickets();}
  catch(e){el('supportMessage').textContent='Yanıt gönderilemedi: '+e.message;}
}
window.loadTickets=loadTickets;window.selectTicket=selectTicket;window.sendReply=sendReply;
loadTickets();setInterval(loadTickets,20000);
