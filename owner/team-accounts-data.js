(()=>{
  const target=document.getElementById('teamAccountContent');
  if(!target)return;
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stateLabel=status=>({active:['Aktif',''],not_configured:['Kurulum gerekli','is-warning'],credentials_conflict:['Giriş bilgileri ayrılmalı','is-error']}[status]||['Kontrol gerekli','is-warning']);
  async function load(){
    try{
      const response=await fetch('../api/owner/team-accounts',{credentials:'include',cache:'no-store'});
      if(!response.ok)throw new Error('Ekip hesabı bilgisi alınamadı. Owner oturumunu yenileyin.');
      const data=await response.json(),accounts=Array.isArray(data.accounts)?data.accounts:[];
      if(!accounts.length){target.innerHTML='Henüz ekip e-posta adresi yapılandırılmamış. Render ortam grubuna <code>TEAM_ADMIN_EMAIL</code>, <code>TEAM_ADMIN_PASSWORD</code> ve <code>TEAM_ADMIN_TOTP_SECRET</code> ekleyip servisi yeniden yayınlayın.';return;}
      target.className='team-account-table-wrap';
      target.innerHTML='<table class="team-account-table"><thead><tr><th>Hesap</th><th>E-posta</th><th>İki aşamalı doğrulama</th><th>Durum</th></tr></thead><tbody>'+accounts.map(account=>{
        const [label,className]=stateLabel(account.status);
        return `<tr><td><b>${escapeHtml(account.id||'Ekip hesabı')}</b></td><td class="team-account-email">${escapeHtml(account.email||'—')}</td><td>${account.twoFactorEnabled?'Açık':'Kapalı'}</td><td><span class="team-account-badge ${className}">${label}</span></td></tr>`;
      }).join('')+'</tbody></table>';
      if(!data.configured){const note=document.createElement('p');note.className='team-account-footnote';note.textContent='E-posta kayıtlı, ancak giriş yapılandırması tamamlanmamış veya Owner bilgilerinden ayrılmamış. Render ortam değişkenlerini kontrol edin.';target.appendChild(note);}
    }catch(error){target.textContent=error.message||'Ekip hesabı bilgisi alınamadı.';}
  }
  load();
})();
