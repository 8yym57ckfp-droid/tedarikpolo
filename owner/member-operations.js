const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const money = value => Number(value || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' USDT';
const dateTime = value => value ? new Date(value).toLocaleString('tr-TR') : '—';
let currentUserId = null;
let currentSecurity = null;

function setMessage(id, message, error = false) {
  const element = $(id);
  element.textContent = message;
  element.dataset.state = error ? 'error' : 'success';
}

function accountStatus(status) {
  if (status === 'suspended') return {label:'Askıya alındı', className:'suspended'};
  if (status === 'locked') return {label:'Kilitli', className:'locked'};
  return {label:'Aktif', className:'active'};
}

function updateSecurityView(security) {
  currentSecurity = security || {status:'active'};
  const status = accountStatus(currentSecurity.status);
  $('memberStatus').textContent = status.label;
  $('memberStatus').className = `member-status ${status.className}`;
  $('securityReason').value = currentSecurity.reason || '';
  $('securityAction').textContent = currentSecurity.status === 'active' ? 'Üyeyi Askıya Al' : 'Hesabı Yeniden Etkinleştir';
  $('securityAction').classList.toggle('danger', currentSecurity.status === 'active');
}

async function load() {
  try {
    const data = await adminFetch('/user-center?q=' + encodeURIComponent($('q').value || ''));
    $('rows').innerHTML = data.users.length ? data.users.map(user => {
      const status = accountStatus(user.securityStatus || 'active');
      const kycClass = user.kycStatus === 'pending' ? 's-pending' : user.kycStatus === 'approved' ? 's-approved' : 's-auto';
      return `<tr>
        <td><span class="user-name">${esc(user.firstName || '')} ${esc(user.lastName || '')}</span><span class="sub">${esc(user.email)} · ${esc(user.id)}</span></td>
        <td class="amount">${money(user.balance)}</td><td>${money(user.totalDeposits)}</td><td>${money(user.totalWithdrawals)}</td>
        <td>${Number(user.pendingCount || 0)}</td><td><span class="status ${kycClass}">${esc(user.kycStatus || 'not_started')}</span></td>
        <td><span class="member-status ${status.className}">${status.label}</span></td>
        <td><button class="mini" type="button" data-open-user="${esc(user.id)}">Yönet</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="8">Kullanıcı bulunamadı.</td></tr>';

    $('kyc').innerHTML = data.kycPending.length ? data.kycPending.map(item => `
      <div class="kyc-row"><b>${esc(item.name || 'İsimsiz')}</b><span>${esc(item.email)}</span><span>${esc(dateTime(item.submittedAt))}</span>
        <div class="side-actions"><button class="mini ok" type="button" data-kyc-user="${esc(item.userId)}" data-kyc-decision="approved">Onayla</button><button class="mini no" type="button" data-kyc-user="${esc(item.userId)}" data-kyc-decision="rejected">Reddet</button></div>
      </div>`).join('') : '<div class="admin-muted">Bekleyen KYC yok.</div>';
  } catch (error) {
    $('rows').innerHTML = '<tr><td colspan="8">Üye listesi alınamadı. Yeniden deneyin.</td></tr>';
    $('kyc').textContent = 'KYC bilgileri alınamadı.';
  }
}

async function openUser(id) {
  try {
    const encodedId = encodeURIComponent(id);
    const [data, securityData] = await Promise.all([
      adminFetch('/user/' + encodedId),
      adminFetch('/user/' + encodedId + '/security')
    ]);
    const user = data.user;
    currentUserId = user.id;
    $('name').textContent = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Üye';
    $('email').textContent = `${user.email} · ${user.id}`;
    $('bal').textContent = money(user.balance);
    $('dep').textContent = money(data.summary.deposits);
    $('wd').textContent = money(data.summary.withdrawals);
    $('accountEmail').value = user.email || '';
    $('accountPassword').value = '';
    $('accountSaveMsg').textContent = '';
    updateSecurityView(securityData.security);
    $('txs').innerHTML = data.transactions.map(transaction => `<div class="tx"><b>${esc(transaction.id)} · ${transaction.type === 'deposit' ? 'Yatırım' : 'Çekim'} · ${esc(transaction.status)}</b><small>${money(transaction.amount)} · ${esc(transaction.network || '—')} · ${esc(dateTime(transaction.createdAt))}</small><small>${esc(transaction.txHash || 'TX hash yok')}</small></div>`).join('') || '<div class="admin-muted">İşlem yok.</div>';
    $('panel').classList.add('open');
    $('panel').setAttribute('aria-hidden', 'false');
  } catch (error) {
    window.alert(error.message || 'Üye bilgileri alınamadı.');
  }
}

async function saveAccount(event) {
  event.preventDefault();
  if (!currentUserId) return;
  const email = $('accountEmail').value.trim();
  const password = $('accountPassword').value;
  if (password && password.length < 8) {
    setMessage('accountSaveMsg', 'Şifre en az 8 karakter olmalı.', true);
    return;
  }
  const button = $('accountSaveButton');
  button.disabled = true;
  try {
    const result = await adminFetch('/user/' + encodeURIComponent(currentUserId) + '/account', {
      method:'POST', body:JSON.stringify({email, password})
    });
    $('accountEmail').value = result.user.email;
    $('accountPassword').value = '';
    $('email').textContent = `${result.user.email} · ${result.user.id}`;
    setMessage('accountSaveMsg', 'Hesap bilgileri kaydedildi. Üyenin yeniden giriş yapması gerekiyor.');
    await load();
  } catch (error) {
    setMessage('accountSaveMsg', error.message || 'Hesap bilgileri kaydedilemedi.', true);
  } finally {
    button.disabled = false;
  }
}

async function toggleSuspension() {
  if (!currentUserId || !currentSecurity) return;
  const action = currentSecurity.status === 'active' ? 'suspend' : 'restore';
  const prompt = action === 'suspend' ? 'Bu üyeyi askıya almak istiyor musunuz?' : 'Bu üyenin hesabını yeniden etkinleştirmek istiyor musunuz?';
  if (!window.confirm(prompt)) return;
  const button = $('securityAction');
  button.disabled = true;
  try {
    const result = await adminFetch('/user/' + encodeURIComponent(currentUserId) + '/security', {
      method:'POST', body:JSON.stringify({action, reason:$('securityReason').value.trim()})
    });
    updateSecurityView(result.security);
    setMessage('securitySaveMsg', action === 'suspend' ? 'Üye askıya alındı ve oturumları kapatıldı.' : 'Üye hesabı yeniden etkinleştirildi.');
    await load();
  } catch (error) {
    setMessage('securitySaveMsg', error.message || 'Hesap durumu güncellenemedi.', true);
  } finally {
    button.disabled = false;
  }
}

async function decideKyc(userId, decision) {
  const prompt = decision === 'approved' ? 'KYC başvurusunu onayla?' : 'KYC başvurusunu reddet?';
  if (!window.confirm(prompt)) return;
  try {
    await adminFetch('/kyc/decision', {method:'POST', body:JSON.stringify({userId, decision})});
    await load();
  } catch (error) {
    window.alert(error.message || 'KYC kararı kaydedilemedi.');
  }
}

function closePanel() {
  $('panel').classList.remove('open');
  $('panel').setAttribute('aria-hidden', 'true');
  currentUserId = null;
  currentSecurity = null;
}

$('rows').addEventListener('click', event => {
  const button = event.target.closest('[data-open-user]');
  if (button) openUser(button.dataset.openUser);
});
$('kyc').addEventListener('click', event => {
  const button = event.target.closest('[data-kyc-user]');
  if (button) decideKyc(button.dataset.kycUser, button.dataset.kycDecision);
});
$('q').addEventListener('keydown', event => { if (event.key === 'Enter') load(); });
$('accountForm').addEventListener('submit', saveAccount);
$('securityAction').addEventListener('click', toggleSuspension);
$('closePanel').addEventListener('click', closePanel);
$('panel').addEventListener('click', event => { if (event.target === $('panel')) closePanel(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('panel').classList.contains('open')) closePanel(); });
load();
