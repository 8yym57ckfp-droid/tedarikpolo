'use strict';

const FIRST_NAMES = [
  'Aylin', 'Barış', 'Burcu', 'Cem', 'Ceren', 'Deniz', 'Ece', 'Emre', 'Esra', 'Fırat',
  'Gizem', 'Hakan', 'İrem', 'Kaan', 'Mert', 'Melis', 'Nehir', 'Onur', 'Ozan', 'Seda',
  'Selin', 'Serkan', 'Sibel', 'Tolga', 'Yasemin', 'Yusuf', 'Zeynep', 'Bora', 'Derya', 'Eylül'
];
const LAST_NAMES = [
  'Aksoy', 'Aydın', 'Arslan', 'Atalay', 'Avcı', 'Başaran', 'Bulut', 'Çelik', 'Demir', 'Doğan',
  'Erdem', 'Güneş', 'Kaplan', 'Kara', 'Karaca', 'Kaya', 'Koç', 'Korkmaz', 'Özdemir', 'Öztürk',
  'Şahin', 'Tekin', 'Yalçın', 'Yıldırım', 'Yılmaz', 'Çetin', 'Polat', 'Kılıç', 'Taş', 'Turan'
];
const DAILY_DEPOSIT_TARGETS = [1_180_000, 2_240_000, 3_160_000, 4_080_000];
const DAY_MS = 86400000;

function makeRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
function cents(value) { return Math.round(Number(value) * 100) / 100; }
function splitAmount(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let left = cents(total);
  return weights.map((weight, index) => {
    const part = index === weights.length - 1 ? left : cents(total * weight / sum);
    left = cents(left - part);
    return part;
  });
}

function makeSyntheticMembers({ runId, targetUser, passwordHash, startDate, count = 11, existingUsers = [] }) {
  const rand = makeRandom(`${runId}:names`);
  const members = [targetUser];
  const existingEmails = new Set(existingUsers.map(x => String(x.email || '').toLowerCase()));
  const existingPhones = new Set(existingUsers.map(x => String(x.phone || '')));
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const shortRun = String(runId).replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();

  for (let i = 0; i < count; i++) {
    let firstName, lastName, email, phone, attempt = 0;
    do {
      firstName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
      lastName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
      const uniquePart = `${shortRun}.${String(i + 1).padStart(2, '0')}${attempt ? `.x${attempt}` : ''}`;
      email = `uye.${uniquePart}@example.invalid`;
      phone = `+990000${shortRun.replace(/[^0-9]/g, '').slice(-4).padStart(4, '0')}${String(i + 1).padStart(2, '0')}${String(attempt).padStart(2, '0')}`;
      attempt++;
    } while (existingEmails.has(email) || existingPhones.has(phone));
    existingEmails.add(email); existingPhones.add(phone);
    members.push({
      id: null,
      firstName,
      lastName,
      username: `test_${shortRun}_${String(i + 1).padStart(2, '0')}`.slice(0, 20),
      email,
      phone,
      passwordHash,
      role: 'user',
      balance: 0,
      referralEarnings: 0,
      referralCode: `SYN-${shortRun.toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
      referredBy: targetUser.referralCode,
      twoFactorEnabled: false,
      phoneVerified: false,
      emailVerified: false,
      createdAt: new Date(start.getTime() - 30 * DAY_MS).toISOString(),
      isSynthetic: true,
      testRunId: runId
    });
  }
  return members;
}

function makeSyntheticTransactions({ runId, users, startDate, days = 90 }) {
  const rand = makeRandom(`${runId}:transactions`);
  const balances = new Map(users.map(user => [String(user.id), Number(user.balance || 0)]));
  const rows = [];
  let sequence = 0;
  const firstDay = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const shortRun = String(runId).replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
  const nextId = () => `SYN-${shortRun}-${String(++sequence).padStart(5, '0')}`;
  const choose = list => list[Math.floor(rand() * list.length)];
  const makeRequest = (user, type, amount, day, slot, decision, network) => {
    const created = new Date(firstDay + day * DAY_MS + 12 * 3600000 + slot * 5 * 60000);
    const decided = new Date(created.getTime() + 5 * 60000);
    const id = nextId();
    return {
      transaction: {
        id, userId: String(user.id), type, amount: cents(amount), requestedAmount: cents(amount), receivedAmount: null,
        currency: 'USDT', network, status: 'pending', createdAt: created.toISOString(), txHash: null,
        address: null, walletId: null, requestKey: `${runId}:${id}`, lockedBy: null, lockedAt: null,
        decisionBy: null, decisionAt: null, expiresAt: new Date(created.getTime() + 30 * 60000).toISOString(),
        isSynthetic: true, testRunId: runId
      },
      decision: { status: decision, approvedAmount: cents(amount), decisionAt: decided.toISOString() }
    };
  };

  for (let day = 0; day < days; day++) {
    const target = DAILY_DEPOSIT_TARGETS[day % DAILY_DEPOSIT_TARGETS.length] + Math.round((rand() - 0.5) * 140000);
    const depositCount = 2 + (day % 3);
    const rootShare = cents(target * (0.045 + rand() * 0.025));
    const remaining = cents(target - rootShare);
    const shares = splitAmount(remaining, Array.from({ length: depositCount - 1 }, () => 0.55 + rand()));
    const deposits = [rootShare, ...shares];
    const depositUsers = [users[0]];
    while (depositUsers.length < depositCount) depositUsers.push(choose(users.slice(1)));

    let slot = 0;
    deposits.forEach((amount, index) => {
      const user = depositUsers[index];
      const decision = makeRequest(user, 'deposit', amount, day, slot++, 'approved', rand() < 0.78 ? 'TRC20' : 'ERC20');
      rows.push(decision);
      balances.set(String(user.id), cents((balances.get(String(user.id)) || 0) + amount));
    });

    // Keep one ordinary daily withdrawal on the selected account so its own
    // member dashboard exercises both transaction types across the full range.
    const rootBalance = balances.get(String(users[0].id)) || 0;
    const rootWithdrawal = cents(Math.max(50, Math.min(rootBalance * (0.18 + rand() * 0.16), target * 0.06)));
    const firstWithdrawal = makeRequest(users[0], 'withdrawal', rootWithdrawal, day, slot++, 'approved', rand() < 0.78 ? 'TRC20' : 'ERC20');
    rows.push(firstWithdrawal);
    balances.set(String(users[0].id), cents(rootBalance - rootWithdrawal));

    const desiredWithdrawal = cents(target * (0.24 + rand() * 0.18));
    let remainingWithdrawal = Math.max(0, desiredWithdrawal - rootWithdrawal);
    const candidates = users.slice(1).filter(u => (balances.get(String(u.id)) || 0) >= 100).sort(() => rand() - 0.5);
    let withdrawalCount = 0;
    for (const user of candidates) {
      if (remainingWithdrawal < 50 || withdrawalCount >= 2) break;
      const balance = balances.get(String(user.id)) || 0;
      const amount = cents(Math.min(remainingWithdrawal, Math.max(50, balance * (0.2 + rand() * 0.18))));
      if (amount < 50 || amount > balance) continue;
      rows.push(makeRequest(user, 'withdrawal', amount, day, slot++, 'approved', rand() < 0.78 ? 'TRC20' : 'ERC20'));
      balances.set(String(user.id), cents(balance - amount));
      remainingWithdrawal = cents(remainingWithdrawal - amount);
      withdrawalCount++;
    }

    if (day % 11 === 5) {
      const user = choose(users);
      rows.push(makeRequest(user, rand() < 0.5 ? 'deposit' : 'withdrawal', cents(50 + rand() * 450), day, slot, 'rejected', rand() < 0.78 ? 'TRC20' : 'ERC20'));
    }
  }

  // Leave a small live queue so the Owner can exercise the normal pending
  // deposit and withdrawal screens after importing the historical activity.
  const currentTime = Date.now();
  for (const type of ['deposit', 'withdrawal']) {
    const pending = makeRequest(users[0], type, cents(50 + rand() * 450), days - 1, rows.length, 'pending', rand() < 0.78 ? 'TRC20' : 'ERC20');
    pending.transaction.createdAt = new Date(currentTime).toISOString();
    pending.transaction.expiresAt = new Date(currentTime + 30 * 60000).toISOString();
    pending.transaction.decisionAt = null;
    rows.push({ transaction: pending.transaction, decision: null });
  }

  return rows;
}

module.exports = { makeSyntheticMembers, makeSyntheticTransactions };
