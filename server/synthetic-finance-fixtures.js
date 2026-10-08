'use strict';

const FIRST_NAMES = ['Aylin','Barış','Burcu','Cem','Ceren','Deniz','Ece','Emre','Esra','Fırat','Gizem','Hakan','İrem','Kaan','Mert','Melis','Nehir','Onur','Ozan','Seda','Selin','Serkan','Sibel','Tolga','Yasemin','Yusuf','Zeynep','Bora','Derya','Eylül','Berk','Elif','Kerem','Naz','Umut','Aslı','Can','Dilan','Eren','Gül'];
const COMPOUND_FIRST_NAMES = ['Ayşe Nur','Ayşe Gül','Elif Su','Elif Naz','Fatma Zehra','Zeynep Nur','Zeynep Sude','Beyza Nur','Merve Nur','Esra Nur','Nurcan','Ece Su','Sena Nur','Sıla Nur','Tuğba Nur','Duru Ece'];
const LAST_NAMES = ['Aksoy','Aydın','Arslan','Atalay','Avcı','Başaran','Bulut','Çelik','Demir','Doğan','Erdem','Güneş','Kaplan','Kara','Karaca','Kaya','Koç','Korkmaz','Özdemir','Öztürk','Şahin','Tekin','Yalçın','Yıldırım','Yılmaz','Çetin','Polat','Kılıç','Taş','Turan','Ekinci','Karataş','Özer','Acar','Keskin','Güler','Kurt','Önal','Yavuz','Uçar'];
const EXAMPLE_WALLETS = [
  {network:'TRC20',address:'TQ7X9mK2pL8vN4cR6sY3wJ5hF1dA8zBcE'},
  {network:'TRC20',address:'TR8kLm2Np7Qx5Vw9Yc4Hj6Ds3Aa1ZfKpR'},
  {network:'TRC20',address:'TJ4nW8sQ2xL6mP9vK3cY7hR5dF1aBzXeG'},
  {network:'TRC20',address:'TW9pK5rL2mX8cN4vQ7sJ3hD6fA1yZbCeR'},
  {network:'TRC20',address:'TN6xQ3vK8mL1pR5sY9cW2jH7dF4aZbXeG'},
  {network:'ERC20',address:'0x742d35Cc6634C0532925a3b844Bc454e4438f44e'},
  {network:'ERC20',address:'0x8Ba1f109551bD432803012645Ac136ddd64DBA72'},
  {network:'ERC20',address:'0x52908400098527886E0F7030069857D2E4169EE7'},
  {network:'ERC20',address:'0xde709f2102306220921060314715629080e2fb77'}
];
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
function makeFirstName(rand) { return rand() < 0.2 ? COMPOUND_FIRST_NAMES[Math.floor(rand() * COMPOUND_FIRST_NAMES.length)] : FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]; }
function usernamePart(value) {
  return String(value || '').toLocaleLowerCase('tr-TR').replace(/[ç]/g,'c').replace(/[ğ]/g,'g').replace(/[ı]/g,'i').replace(/[ö]/g,'o').replace(/[ş]/g,'s').replace(/[ü]/g,'u').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').replace(/_+/g,'_');
}
function makeSyntheticUsername(firstName,lastName,usedUsernames=new Set()) {
  const base=`${usernamePart(firstName)}_${usernamePart(lastName)}`.replace(/^_+|_+$/g,'').slice(0,20);
  for(let suffixNumber=1;suffixNumber<10000;suffixNumber++){
    const suffix=suffixNumber===1?'':`_${suffixNumber}`,candidate=`${base.slice(0,20-suffix.length)}${suffix}`;
    if(candidate.length>=3&&!usedUsernames.has(candidate)){usedUsernames.add(candidate);return candidate;}
  }
  throw new Error('synthetic_username_space_exhausted');
}
function walletForSyntheticDeposit(transaction,wallets) {
  if(!transaction||transaction.type!=='deposit'||!Array.isArray(wallets))return null;
  const choices=wallets.filter(wallet=>wallet.network===transaction.network);
  if(!choices.length)return null;
  let hash=2166136261;for(const char of String(transaction.id||''))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  return choices[hash%choices.length];
}
function makeSyntheticWallets({runId,teamAccountId,transactions=[]}) {
  const suffix=String(runId).replace(/[^a-z0-9]/gi,'').slice(-8).toUpperCase();
  const wallets=EXAMPLE_WALLETS.map((item,index)=>({
    id:`SYN-WLT-${suffix}-${String(index+1).padStart(2,'0')}`,network:item.network,address:item.address,
    label:`Örnek ${item.network} cüzdanı ${String(index+1).padStart(2,'0')}`,active:false,teamId:teamAccountId,
    createdBy:'synthetic-fixture',createdAt:null,updatedAt:null,useCount:0,lastUsedAt:null,
    minDepositAmount:60,maxDepositAmount:2000,minDepositOwnerSet:true,maxDepositOwnerSet:true,
    isSynthetic:true,testRunId:runId
  }));
  const byId=new Map(wallets.map(wallet=>[wallet.id,wallet]));
  const unwrap=item=>item?.transaction||item;
  const ordered=transactions.filter(item=>unwrap(item)?.type==='deposit').slice().sort((a,b)=>String(unwrap(a).id).localeCompare(String(unwrap(b).id)));
  for(const item of ordered){
    const transaction=unwrap(item),wallet=walletForSyntheticDeposit(transaction,wallets);if(!wallet)continue;
    wallet.useCount++;
    const createdAt=transaction.createdAt||null;
    if(createdAt&&(!wallet.lastUsedAt||new Date(createdAt)>new Date(wallet.lastUsedAt)))wallet.lastUsedAt=createdAt;
  }
  return {wallets,byId};
}
function makeSyntheticIdentity({ runId, index = 0, excludedNames = [] }) {
  const rand = makeRandom(`${runId}:identity:${index}`),excluded=new Set(excludedNames.map(value=>String(value||'').toLocaleLowerCase('tr-TR')));
  for(let attempt=0;attempt<FIRST_NAMES.length*LAST_NAMES.length;attempt++){
    const firstName=makeFirstName(rand),lastName=LAST_NAMES[Math.floor(rand()*LAST_NAMES.length)],fullName=`${firstName} ${lastName}`;
    if(!excluded.has(fullName.toLocaleLowerCase('tr-TR')))return {firstName,lastName};
  }
  throw new Error('synthetic_identity_space_exhausted');
}
function makeSyntheticMembers({ runId, targetUser, passwordHash, startDate, count = 149, existingUsers = [], existingUsernames = null }) {
  const rand = makeRandom(`${runId}:names`), members = [targetUser];
  const existingEmails = new Set(existingUsers.map(x => String(x.email || '').toLowerCase()));
  const existingPhones = new Set(existingUsers.map(x => String(x.phone || '')));
  const usedNames = new Set(existingUsers.map(user=>`${user.firstName||''} ${user.lastName||''}`.trim().toLocaleLowerCase('tr-TR')).filter(Boolean));
  const usedUsernames = existingUsernames instanceof Set ? existingUsernames : new Set(existingUsers.map(user=>String(user.username||'').toLowerCase()).filter(Boolean));
  if(targetUser?.username)usedUsernames.add(String(targetUser.username).toLowerCase());
  if(targetUser?.firstName&&targetUser?.lastName)usedNames.add(`${targetUser.firstName} ${targetUser.lastName}`.toLocaleLowerCase('tr-TR'));
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const shortRun = String(runId).replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
  for (let i = 0; i < count; i++) {
    let firstName, lastName, email, phone, attempt = 0;
    do {
      firstName = makeFirstName(rand);
      lastName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
      const suffix = `${shortRun}.${String(i + 1).padStart(3, '0')}${attempt ? `.x${attempt}` : ''}`;
      email = `uye.${suffix}@example.invalid`;
      phone = `+990000${String(i + 1).padStart(6, '0')}${String(attempt).padStart(2, '0')}`;
      attempt++;
    } while ((existingEmails.has(email) || existingPhones.has(phone) || usedNames.has(`${firstName} ${lastName}`.toLocaleLowerCase('tr-TR'))) && attempt<10000);
    if(attempt>=10000&&(existingEmails.has(email)||existingPhones.has(phone)||usedNames.has(`${firstName} ${lastName}`.toLocaleLowerCase('tr-TR'))))throw new Error('synthetic_name_space_exhausted');
    existingEmails.add(email); existingPhones.add(phone);
    usedNames.add(`${firstName} ${lastName}`.toLocaleLowerCase('tr-TR'));
    members.push({
      id: null, firstName, lastName, username: makeSyntheticUsername(firstName,lastName,usedUsernames), email, phone,
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
  const quietWindows=Array.from({length:days},()=>rand()<0.42?{start:8+Math.floor(rand()*10),length:1+Math.floor(rand()*3)}:null);
  let sequence = 0;
  const shortRun = String(runId).replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
  const nextId = () => `SYN-${shortRun}-${String(++sequence).padStart(6, '0')}`;
  const choose = list => list[Math.floor(rand() * list.length)];
  const makeTime = day => {
    // Night activity is sparse; each day may also contain a quiet 1–3 hour interval.
    const quiet=quietWindows[day];let hour=0,attempts=0;
    do{
      const band=rand();
      if(band<0.025)hour=rand()*5;
      else if(band<0.19)hour=5+rand()*4;
      else if(band<0.50)hour=9+rand()*4;
      else if(band<0.82)hour=13+rand()*5;
      else hour=18+rand()*6;
      attempts++;
    }while(quiet&&hour>=quiet.start&&hour<quiet.start+quiet.length&&attempts<12);
    const minute = Math.floor(rand() * 60), second = Math.floor(rand() * 60);
    return new Date(firstDay + day * DAY_MS + Math.floor(hour * 3600000) + minute * 60000 + second * 1000);
  };
  const makeRequest = (user, type, amount, day, decision, network) => {
    const created = makeTime(day), dayEnd = Math.floor(created.getTime() / DAY_MS) * DAY_MS + DAY_MS - 1000;
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
      const plannedAmount=depositAmount(),amount=Math.min(plannedAmount,cents(target-collected));
      const truncatedFinalAmount=amount<plannedAmount;
      if (amount < MIN_DEPOSIT || (truncatedFinalAmount && amount < 90)) {
        if (collected === 0) break;
        const last = depositedToday[depositedToday.length - 1];
        const mergedAmount=last?cents(last.transaction.amount+amount):null;
        if (last && mergedAmount <= MAX_TRANSACTION && (mergedAmount < 70 || mergedAmount >= 90)) {
          last.transaction.amount = mergedAmount;
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

module.exports = { makeSyntheticIdentity, makeSyntheticUsername, makeSyntheticMembers, makeSyntheticTransactions, makeSyntheticWallets, walletForSyntheticDeposit };
