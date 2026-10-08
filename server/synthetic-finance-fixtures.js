'use strict';

const FIRST_NAMES = ['Aylin','Barış','Burcu','Cem','Ceren','Deniz','Ece','Emre','Esra','Fırat','Gizem','Hakan','İrem','Kaan','Mert','Melis','Nehir','Onur','Ozan','Seda','Selin','Serkan','Sibel','Tolga','Yasemin','Yusuf','Zeynep','Bora','Derya','Eylül','Berk','Elif','Kerem','Naz','Umut','Aslı','Can','Dilan','Eren','Gül'];
const LAST_NAMES = ['Aksoy','Aydın','Arslan','Atalay','Avcı','Başaran','Bulut','Çelik','Demir','Doğan','Erdem','Güneş','Kaplan','Kara','Karaca','Kaya','Koç','Korkmaz','Özdemir','Öztürk','Şahin','Tekin','Yalçın','Yıldırım','Yılmaz','Çetin','Polat','Kılıç','Taş','Turan','Ekinci','Karataş','Özer','Acar','Keskin','Güler','Kurt','Önal','Yavuz','Uçar'];
const DAY_MS = 86400000;
const MIN_DEPOSIT = 60;
const MIN_WITHDRAWAL = 100;
const MAX_TRANSACTION = 2000;

function makeRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
function cents(value) { return Math.round(Number(value) * 100) / 100; }
function makeSyntheticIdentity({ runId, index = 0, excludedNames = [] }) {
  const rand = makeRandom(`${runId}:identity:${index}`),excluded=new Set(excludedNames.map(value=>String(value||'').toLocaleLowerCase('tr-TR')));
  for(let attempt=0;attempt<FIRST_NAMES.length*LAST_NAMES.length;attempt++){
    const firstName=FIRST_NAMES[Math.floor(rand()*FIRST_NAMES.length)],lastName=LAST_NAMES[Math.floor(rand()*LAST_NAMES.length)],fullName=`${firstName} ${lastName}`;
    if(!excluded.has(fullName.toLocaleLowerCase('tr-TR')))return {firstName,lastName};
  }
  throw new Error('synthetic_identity_space_exhausted');
}
function makeSyntheticMembers({ runId, targetUser, passwordHash, startDate, count = 149, existingUsers = [] }) {
  const rand = makeRandom(`${runId}:names`), members = [targetUser];
  const existingEmails = new Set(existingUsers.map(x => String(x.email || '').toLowerCase()));
  const existingPhones = new Set(existingUsers.map(x => String(x.phone || '')));
  const usedNames = new Set(targetUser?.firstName&&targetUser?.lastName?[`${targetUser.firstName} ${targetUser.lastName}`.toLocaleLowerCase('tr-TR')]:[]);
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const shortRun = String(runId).replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
  for (let i = 0; i < count; i++) {
    let firstName, lastName, email, phone, attempt = 0;
    do {
      firstName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
      lastName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
      const suffix = `${shortRun}.${String(i + 1).padStart(3, '0')}${attempt ? `.x${attempt}` : ''}`;
      email = `uye.${suffix}@example.invalid`;
      phone = `+990000${String(i + 1).padStart(6, '0')}${String(attempt).padStart(2, '0')}`;
      attempt++;
    } while (existingEmails.has(email) || existingPhones.has(phone) || usedNames.has(`${firstName} ${lastName}`.toLocaleLowerCase('tr-TR')));
    existingEmails.add(email); existingPhones.add(phone);
    usedNames.add(`${firstName} ${lastName}`.toLocaleLowerCase('tr-TR'));
    members.push({
      id: null, firstName, lastName, username: `test_${shortRun}_${String(i + 1).padStart(3, '0')}`.slice(0, 24), email, phone,
      passwordHash, role: 'user', balance: 0, referralEarnings: 0,
      referralCode: `SYN-${shortRun.toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
      referredBy: targetUser.referralCode, twoFactorEnabled: false, phoneVerified: false, emailVerified: false,
      createdAt: new Date(start.getTime() - Math.floor(rand() * 30) * DAY_MS).toISOString(),
      isTestAccount: true, isSynthetic: true, testRunId: runId
    });
  }
  return members;
}

function makeSyntheticTransactions({ runId, users, startDate, days = 90, teamAccountId = null }) {
  const rand = makeRandom(`${runId}:transactions`), balances = new Map(users.map(user => [String(user.id), Number(user.balance || 0)]));
  const rows = [], firstDay = new Date(`${startDate}T00:00:00.000Z`).getTime();
  let sequence = 0;
  const shortRun = String(runId).replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
  const nextId = () => `SYN-${shortRun}-${String(++sequence).padStart(6, '0')}`;
  const choose = list => list[Math.floor(rand() * list.length)];
  const makeTime = (day, type) => {
    // Activity is lighter overnight; deposits and withdrawals get independent minute/second stamps.
    const hour = rand() < 0.035 ? Math.floor(rand() * 4) : type === 'deposit' ? 6 + Math.floor(rand() * 13) : 19 + Math.floor(rand() * 5);
    const minute = Math.floor(rand() * 60), second = Math.floor(rand() * 60);
    return new Date(firstDay + day * DAY_MS + hour * 3600000 + minute * 60000 + second * 1000);
  };
  const makeRequest = (user, type, amount, day, decision, network) => {
    const created = makeTime(day, type), dayEnd = Math.floor(created.getTime() / DAY_MS) * DAY_MS + DAY_MS - 1000;
    const decided = new Date(Math.min(created.getTime() + (2 + Math.floor(rand() * 49)) * 60000, dayEnd)), id = nextId();
    return {
      transaction: {
        id, userId: String(user.id), type, amount: cents(amount), requestedAmount: cents(amount), receivedAmount: null,
        currency: 'USDT', network, status: 'pending', createdAt: created.toISOString(), txHash: null, address: null,
        walletId: null, teamAccountId, claimedByTeamId: type === 'withdrawal' && decision === null ? teamAccountId : null,
        claimedAt: type === 'withdrawal' && decision === null ? created.toISOString() : null,
        requestKey: `${runId}:${id}`, lockedBy: null, lockedAt: null, decisionBy: null,
        decisionAt: decision ? decided.toISOString() : null, expiresAt: new Date(created.getTime() + 30 * 60000).toISOString(),
        isSynthetic: true, testRunId: runId
      },
      decision: decision ? { status: decision, approvedAmount: cents(amount), decisionAt: decided.toISOString() } : null
    };
  };
  const network = () => rand() < 0.78 ? 'TRC20' : 'ERC20';
  const depositAmount = () => rand() < 0.004 ? cents(60 + rand() * 10) : cents(90 + rand() * (MAX_TRANSACTION - 90));

  for (let day = 0; day < days; day++) {
    const dayMode = rand();
    const target = dayMode < 0.075 ? 0 : dayMode < 0.22 ? 9000 + rand() * 26000 : 81334.2 + (rand() - 0.5) * 7000;
    let collected = 0;
    const depositedToday = [];
    while (collected < target) {
      const amount = Math.min(depositAmount(), cents(target - collected));
      if (amount < MIN_DEPOSIT) {
        if (collected === 0) break;
        const last = depositedToday[depositedToday.length - 1];
        if (last && last.transaction.amount + amount <= MAX_TRANSACTION) {
          last.transaction.amount = cents(last.transaction.amount + amount);
          last.transaction.requestedAmount = last.transaction.amount;
          last.decision.approvedAmount = last.transaction.amount;
          balances.set(String(last.transaction.userId), cents((balances.get(String(last.transaction.userId)) || 0) + amount));
          collected = cents(collected + amount);
        }
        break;
      }
      const user = choose(users), item = makeRequest(user, 'deposit', amount, day, 'approved', network());
      rows.push(item); depositedToday.push(item); collected = cents(collected + amount);
      balances.set(String(user.id), cents((balances.get(String(user.id)) || 0) + amount));
    }

    // A few transactions are declined for realistic rejected-history coverage.
    if (dayMode >= 0.075 && rand() < 0.09) {
      const user = choose(users), item = makeRequest(user, 'deposit', cents(100 + rand() * 900), day, 'rejected', network());
      rows.push(item);
    }

    let withdrawalTarget = cents(collected * (0.18 + rand() * 0.2)), withdrawn = 0, attempts = 0;
    while (withdrawn < withdrawalTarget && attempts++ < 120) {
      const candidates = users.filter(user => (balances.get(String(user.id)) || 0) >= MIN_WITHDRAWAL);
      if (!candidates.length) break;
      const user = choose(candidates), balance = balances.get(String(user.id)) || 0;
      const amount = cents(Math.min(balance, MIN_WITHDRAWAL + rand() * (MAX_TRANSACTION - MIN_WITHDRAWAL), withdrawalTarget - withdrawn));
      if (amount < MIN_WITHDRAWAL) break;
      const item = makeRequest(user, 'withdrawal', amount, day, 'approved', network());
      rows.push(item); withdrawn = cents(withdrawn + amount); balances.set(String(user.id), cents(balance - amount));
    }
  }

  // A small pending queue on the final date lets the team exercise the live review screen.
  const today = days - 1;
  for (const type of ['deposit', 'withdrawal']) {
    const user = type === 'withdrawal' ? users.find(candidate => (balances.get(String(candidate.id)) || 0) >= 250) || users[0] : choose(users);
    const balance = balances.get(String(user.id)) || 0;
    const amount = type === 'withdrawal' ? cents(Math.max(MIN_WITHDRAWAL, Math.min(250 + rand() * 700, balance || 250))) : cents(250 + rand() * 700);
    const pending = makeRequest(user, type, amount, today, null, network());
    const now = Date.now();
    pending.transaction.createdAt = new Date(now - Math.floor(rand() * 12 * 60000)).toISOString();
    pending.transaction.expiresAt = new Date(now + 30 * 60000).toISOString();
    rows.push(pending);
  }
  return rows;
}

module.exports = { makeSyntheticIdentity, makeSyntheticMembers, makeSyntheticTransactions };
