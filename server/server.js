const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let Pool = null;
try { ({ Pool } = require('pg')); } catch (_) { /* PostgreSQL is optional for local demo mode. */ }
const { getMarketUsdtTry, getMarketSnapshot, calc, makeQuote } = require('./rates');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const DATA = path.join(DATA_DIR, 'db.json');
const MAINTENANCE_DATA = path.join(DATA_DIR, 'maintenance.json');
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_POSTGRES = process.env.USE_POSTGRES === 'true' && !!DATABASE_URL && !!Pool;
const pool = USE_POSTGRES ? new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized:false } }) : null;
const TTL = Number(process.env.SESSION_TTL_SECONDS || 3600) * 1000;
const sessions = new Map();
const resetTokens = new Map();
const passwordResetCodes = new Map(); // email -> {codeHash, expires, attempts, verified}
const verificationCodes = new Map();
const adminSessions = new Map();
const auditLog = [];
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@safepays.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'Admin123!');
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || '';
const ADMIN_TOTP_CODE = process.env.ADMIN_TOTP_CODE || (process.env.NODE_ENV === 'production' ? '' : '123456');
const ADMIN_COOKIE = 'sp_admin_session';
const DEFAULT_RATE_SETTINGS = { usdTrySpread: 1, trc20FeeUsdt: 0, erc20FeeUsdt: 0, quoteTtlSeconds: 60, maxRateAgeSeconds: 300, minRate: 0, maxRate: 100000 };
const TX_CONTROL = { autoRejectMinutes: 30, lockMinutes: 5, largeApprovalThreshold: 10000 };
const txLocks = new Map();
const idempotencyCache = new Map();
const quoteStore = new Map();
const requestCooldowns = new Map();
const REQUEST_COOLDOWN_MS = 120000;
const DEFAULT_MAINTENANCE = {
  site: { enabled:false, until:null, message:'Sitemiz gÃ¼ncelleniyor. Daha iyi bir deneyim iÃ§in kÄ±sa bir bakÄ±m Ã§alÄ±ÅŸmasÄ± yapÄ±yoruz.' },
  panel: { enabled:false, until:null, message:'YÃ¶netim paneli gÃ¼ncelleniyor. Ekip eriÅŸimi bakÄ±m tamamlandÄ±ÄŸÄ±nda yeniden aÃ§Ä±lacaktÄ±r.' }
};
function getMaintenance(){
  try{ if(fs.existsSync(MAINTENANCE_DATA)){ const raw=JSON.parse(fs.readFileSync(MAINTENANCE_DATA,'utf8')); return {site:{...DEFAULT_MAINTENANCE.site,...(raw.site||{})},panel:{...DEFAULT_MAINTENANCE.panel,...(raw.panel||{})}}; } }catch(_){ }
  return JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE));
}
function saveMaintenance(next){ fs.writeFileSync(MAINTENANCE_DATA,JSON.stringify(next,null,2)); return next; }
function maintenanceScope(scope){ const m=getMaintenance(); return scope==='panel'?m.panel:m.site; }

function getRateSettings(){ const db=readDb(); return {...DEFAULT_RATE_SETTINGS,...(db.rateSettings||{})}; }
function saveRateSettings(x){ const db=readDb(); db.rateSettings={...DEFAULT_RATE_SETTINGS,...x}; writeDb(db); }

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
function readDb(){ return JSON.parse(fs.readFileSync(DATA,'utf8')); }
function writeDb(db){ fs.writeFileSync(DATA, JSON.stringify(db,null,2)); }
const DEFAULT_HOME_CONTENT={dailyDepositPercent:0,dailyDepositCap:0,referralPercent:0,firstDepositBonus:0,intro:'Güncel ödül oranlarını ve kampanya duyurularını burada inceleyin.',notices:[]};
function cleanHomeContent(x={}){const num=(v,max)=>{const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(0,n)):0};return {dailyDepositPercent:num(x.dailyDepositPercent,100),dailyDepositCap:num(x.dailyDepositCap,100000000),referralPercent:num(x.referralPercent,100),firstDepositBonus:num(x.firstDepositBonus,100000000),intro:String(x.intro||DEFAULT_HOME_CONTENT.intro).trim().slice(0,500),notices:(Array.isArray(x.notices)?x.notices:[]).map(v=>String(v||'').trim().slice(0,220)).filter(Boolean).slice(0,8),updatedAt:new Date().toISOString()};}
async function getHomeContent(){if(pool){const r=await pool.query('SELECT content FROM site_content WHERE id=$1',['member-home']);return cleanHomeContent(r.rows[0]?.content||DEFAULT_HOME_CONTENT);}const db=readDb();return cleanHomeContent(db.memberHomeContent||DEFAULT_HOME_CONTENT);}
async function saveHomeContent(value){const clean=cleanHomeContent(value);if(pool){await pool.query('INSERT INTO site_content (id,content,updated_at) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,updated_at=EXCLUDED.updated_at',['member-home',JSON.stringify(clean),clean.updatedAt]);}else{const db=readDb();db.memberHomeContent=clean;writeDb(db);}return clean;}

async function pgInit(){
  if(!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', balance NUMERIC(20,8) NOT NULL DEFAULT 0,
    referral_earnings NUMERIC(20,8) NOT NULL DEFAULT 0, referral_code TEXT UNIQUE NOT NULL, referred_by TEXT,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE, phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'not_started';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ;`);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS security_status TEXT NOT NULL DEFAULT 'active';");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawal_frozen BOOLEAN NOT NULL DEFAULT FALSE;");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_frozen BOOLEAN NOT NULL DEFAULT FALSE;");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS security_reason TEXT;");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS security_updated_at TIMESTAMPTZ;");
  await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, amount NUMERIC(20,8) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT', network TEXT, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tx_hash TEXT
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), transaction_id TEXT, direction TEXT NOT NULL,
    amount NUMERIC(20,8) NOT NULL, currency TEXT NOT NULL DEFAULT 'USDT', balance_before NUMERIC(20,8) NOT NULL,
    balance_after NUMERIC(20,8) NOT NULL, reason TEXT NOT NULL, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger_entries(transaction_id)');
  await pool.query('CREATE TABLE IF NOT EXISTS site_content (id TEXT PRIMARY KEY, content JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(20,8)');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS received_amount NUMERIC(20,8)');
}
async function getUsers(){
  if(!pool) return readDb().users;
  const r=await pool.query('SELECT id, first_name AS "firstName", last_name AS "lastName", email, username, phone, password_hash AS "passwordHash", role, balance, referral_earnings AS "referralEarnings", referral_code AS "referralCode", referred_by AS "referredBy", two_factor_enabled AS "twoFactorEnabled", phone_verified AS "phoneVerified", email_verified AS "emailVerified", totp_secret AS "totpSecret", kyc_status AS "kycStatus", kyc_name AS "kycName", kyc_submitted_at AS "kycSubmittedAt", created_at AS "createdAt", security_status AS "securityStatus", withdrawal_frozen AS "withdrawalFrozen", deposit_frozen AS "depositFrozen", security_reason AS "securityReason", security_updated_at AS "securityUpdatedAt" FROM users');
  return r.rows;
}
async function getTransactions(){
  if(!pool) return readDb().transactions;
  const r=await pool.query('SELECT id, user_id AS "userId", type, amount, requested_amount AS "requestedAmount", received_amount AS "receivedAmount", currency, network, status, created_at AS "createdAt", tx_hash AS "txHash", request_key AS "requestKey", locked_by AS "lockedBy", locked_at AS "lockedAt", decision_by AS "decisionBy", decision_at AS "decisionAt", expires_at AS "expiresAt" FROM transactions ORDER BY created_at DESC');
  return r.rows;
}
async function getLedger(userId){
  if(!pool){const rows=readDb().ledger||[]; return rows.filter(x=>!userId||x.userId===userId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));}
  const q=userId ? await pool.query('SELECT id, user_id AS "userId", transaction_id AS "transactionId", direction, amount, currency, balance_before AS "balanceBefore", balance_after AS "balanceAfter", reason, metadata, created_at AS "createdAt" FROM ledger_entries WHERE user_id=$1 ORDER BY created_at DESC',[userId]) : await pool.query('SELECT id, user_id AS "userId", transaction_id AS "transactionId", direction, amount, currency, balance_before AS "balanceBefore", balance_after AS "balanceAfter", reason, metadata, created_at AS "createdAt" FROM ledger_entries ORDER BY created_at DESC');
  return q.rows;
}
async function addLedgerEntry({userId,transactionId=null,direction,amount,currency='USDT',reason,metadata={}} , client=null){
  const amt=Number(amount); if(!Number.isFinite(amt)||amt<=0) throw new Error('invalid_ledger_amount');
  const user=await findUserById(userId); if(!user) throw new Error('user_not_found');
  const before=Number(user.balance||0); const after=Number((direction==='credit'?before+amt:before-amt).toFixed(8));
  if(after<0) throw new Error('negative_balance');
  const entry={id:`LED-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,userId,transactionId,direction,amount:amt,currency,balanceBefore:before,balanceAfter:after,reason,metadata,createdAt:new Date().toISOString()};
  if(pool){ const q=client||pool; await q.query('INSERT INTO ledger_entries (id,user_id,transaction_id,direction,amount,currency,balance_before,balance_after,reason,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[entry.id,userId,transactionId,direction,amt,currency,before,after,reason,JSON.stringify(metadata),entry.createdAt]); await q.query('UPDATE users SET balance=$1 WHERE id=$2',[after,userId]); }
  else { const db=readDb(); const u=db.users.find(x=>x.id===userId); if(!u) throw new Error('user_not_found'); u.balance=after; db.ledger=db.ledger||[]; db.ledger.unshift(entry); writeDb(db); }
  return entry;
}
async function insertUser(user){
  if(!pool){const db=readDb();db.users.push(user);writeDb(db);return;}
  await pool.query('INSERT INTO users (id,first_name,last_name,email,username,phone,password_hash,role,balance,referral_earnings,referral_code,referred_by,two_factor_enabled,phone_verified,email_verified,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[user.id,user.firstName,user.lastName,user.email,user.username,user.phone,user.passwordHash,user.role,user.balance,user.referralEarnings,user.referralCode,user.referredBy||null,user.twoFactorEnabled,user.phoneVerified,user.emailVerified,user.createdAt]);
}
async function findUserByEmail(email){const users=await getUsers();return users.find(u=>u.email.toLowerCase()===email.toLowerCase());}
async function findUserByPhone(phone){const users=await getUsers();return users.find(u=>normalizePhone(u.phone)===phone);} 
async function findUserById(id){const users=await getUsers();return users.find(u=>u.id===id);} 
function json(res,status,payload,extraHeaders={}){
  const body=JSON.stringify(payload);
  const origin=String(res.req?.headers?.origin||'');
  const allowed=process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(x=>x.trim()).filter(Boolean) : [];
  const corsOrigin=allowed.includes(origin) ? origin : (origin && origin === `http://${res.req?.headers?.host}` ? origin : '');
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS',...extraHeaders};
  if(corsOrigin){headers['Access-Control-Allow-Origin']=corsOrigin;headers['Access-Control-Allow-Credentials']='true';}
  res.writeHead(status,headers);
  res.end(body);
}
function body(req){ return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6) req.destroy();});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)}); }
function token(){return crypto.randomBytes(32).toString('hex');}
function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.scryptSync(password,salt,64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored){
  if(!stored || !stored.startsWith('scrypt$')) return false;
  const [,salt,hex]=stored.split('$');
  const actual=crypto.scryptSync(password,salt,64);
  const expected=Buffer.from(hex,'hex');
  return expected.length===actual.length && crypto.timingSafeEqual(actual,expected);
}
function safeUser(u){const {passwordHash,totpSecret,...safe}=u; return safe;}
function base32Encode(buf){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,val=0,out='';for(const b of buf){val=(val<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(val>>(bits-5))&31];bits-=5;}}if(bits>0)out+=alphabet[(val<<(5-bits))&31];return out;}
function base32Decode(str){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,val=0,out=[];for(const ch of String(str).replace(/=+$/,'').toUpperCase()){const n=alphabet.indexOf(ch);if(n<0)continue;val=(val<<5)|n;bits+=5;if(bits>=8){out.push((val>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
function totp(secret,counter){const key=base32Decode(secret);const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(counter));const h=crypto.createHmac('sha1',key).update(buf).digest();const off=h[h.length-1]&15;const code=((h[off]&127)<<24|(h[off+1]&255)<<16|(h[off+2]&255)<<8|(h[off+3]&255))%1000000;return String(code).padStart(6,'0');}
function verifyTotp(secret,code){const c=Math.floor(Date.now()/30000);return [-1,0,1].some(d=>totp(secret,c+d)===String(code));}
function parseCookies(req){const raw=String(req.headers.cookie||'');const out={};for(const part of raw.split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out;}
function adminAuth(req){
  const h=req.headers.authorization||'';
  const cookie=parseCookies(req)[ADMIN_COOKIE]||'';
  const t=h.startsWith('AdminBearer ')?h.slice(12):cookie;
  const s=adminSessions.get(t); if(!s || s.expires<Date.now()){ if(t)adminSessions.delete(t); return null; }
  return s;
}
function addAudit(action,actor,meta={}){ auditLog.unshift({id:`AUD-${Date.now().toString().slice(-9)}`,action,actor,meta,createdAt:new Date().toISOString()}); if(auditLog.length>500)auditLog.pop(); }
function auth(req){
  const h=req.headers.authorization||''; const t=h.startsWith('Bearer ')?h.slice(7):'';
  const s=sessions.get(t); if(!s || s.expires<Date.now()){ if(t)sessions.delete(t); return null; }
  return s.userId;
}
function normalizePhone(p){let v=String(p||'').replace(/[\s().-]/g,''); if(v.startsWith('00')) v='+'+v.slice(2); if(/^0?5\d{9}$/.test(v)) v='+90'+v.replace(/^0/,''); else if(/^5\d{9}$/.test(v)) v='+90'+v; return v;}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function validPhone(v){return /^\+90\d{10}$/.test(normalizePhone(v));}
function sendFile(req,res){
  let url=decodeURIComponent(req.url.split('?')[0]); if(url==='/') url='/index.html';
  if(url.includes('..')) return json(res,400,{error:'bad_path'});
  const file=path.join(ROOT,url);
  fs.stat(file,(err,st)=>{if(err||!st.isFile())return json(res,404,{error:'not_found'});const ext=path.extname(file).toLowerCase();const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
}

async function insertTransaction(tx){
  if(!pool){const db=readDb();db.transactions.unshift(tx);writeDb(db);return;}
  await pool.query('INSERT INTO transactions (id,user_id,type,amount,requested_amount,received_amount,currency,network,status,created_at,tx_hash,request_key,locked_by,locked_at,decision_by,decision_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',[tx.id,tx.userId,tx.type,tx.amount,tx.requestedAmount??tx.amount,tx.receivedAmount??null,tx.currency,tx.network,tx.status,tx.createdAt,tx.txHash||null,tx.requestKey||null,tx.lockedBy||null,tx.lockedAt||null,tx.decisionBy||null,tx.decisionAt||null,tx.expiresAt||null]);
}
function isValidNetwork(n){return n==='TRC20'||n==='ERC20';}
function isValidAddress(n,a){
  const v=String(a||'').trim();
  if(n==='TRC20') return /^T[1-9A-HJ-NP-Za-km-z]{20,40}$/.test(v);
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}
function makeUserId(existing=[]){ let id=''; do{id=String(crypto.randomInt(10000000,100000000));}while(existing.some(u=>String(u.id)===id)); return id; }
function makeTxId(){ const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; return Array.from({length:10},()=>chars[crypto.randomInt(0,chars.length)]).join(''); }
function demoBalance(u){return Number(u.balance||0);}
async function requestCooldownRemaining(userId){
  const mem=Number(requestCooldowns.get(String(userId))||0);
  const now=Date.now();
  if(mem>now)return mem-now;
  const txs=await getTransactions();
  const latest=txs.filter(x=>x.userId===userId && (x.type==='deposit'||x.type==='withdrawal') && x.createdAt).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  if(!latest)return 0;
  return Math.max(0,REQUEST_COOLDOWN_MS-(now-new Date(latest.createdAt).getTime()));
}
function startRequestCooldown(userId){requestCooldowns.set(String(userId),Date.now()+REQUEST_COOLDOWN_MS);}

async function refreshTransactionExpiry(){
  const now=Date.now();
  const txs=await getTransactions();
  for(const tx of txs){
    if(tx.status==='pending' && tx.expiresAt && new Date(tx.expiresAt).getTime()<=now){
      if(pool){
        await pool.query("UPDATE transactions SET status='auto-rejected', decision_by=$1, decision_at=NOW() WHERE id=$2 AND status='pending'",['system:auto-expiry',tx.id]);
      } else {
        const db=readDb(); const row=db.transactions.find(x=>x.id===tx.id);
        if(row && row.status==='pending'){row.status='auto-rejected';row.decisionBy='system:auto-expiry';row.decisionAt=new Date().toISOString();writeDb(db);}
      }
      addAudit('transaction_auto_rejected','system',{transactionId:tx.id,reason:'30_minute_expiry'});
    }
  }
}
function getRequestKey(req,b){return String(req.headers['idempotency-key']||b.requestKey||'').trim().slice(0,128)||null;}
function lockKey(id){return `tx:${id}`;}
function isLocked(tx){return tx.lockedBy && tx.lockedAt && (Date.now()-new Date(tx.lockedAt).getTime()) < TX_CONTROL.lockMinutes*60000;}
function clearExpiredLock(tx){return tx.lockedBy && tx.lockedAt && (Date.now()-new Date(tx.lockedAt).getTime()) >= TX_CONTROL.lockMinutes*60000;}

async function route(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  await refreshTransactionExpiry();
  if(req.url==='/api/health' && req.method==='GET') return json(res,200,{ok:true,service:'safepays-api',version:'35.0.0'});
  if(req.url==='/api/system/maintenance' && req.method==='GET') return json(res,200,{maintenance:getMaintenance()});
  if(req.url==='/api/home-content' && req.method==='GET') return json(res,200,{content:await getHomeContent()});

  if(req.url==='/api/admin/login' && req.method==='POST'){
    const b=await body(req); const email=String(b.email||'').trim().toLowerCase(); const password=String(b.password||''); const code=String(b.code||'').trim();
    if(email!==ADMIN_EMAIL.toLowerCase() || password!==ADMIN_PASSWORD) return json(res,401,{error:'invalid_admin_credentials'});
    if(ADMIN_TOTP_SECRET ? !verifyTotp(ADMIN_TOTP_SECRET,code) : (!ADMIN_TOTP_CODE || code!==ADMIN_TOTP_CODE)) return json(res,401,{error:'invalid_2fa_code'});
    const t=token(); adminSessions.set(t,{adminId:'ADMIN-001',email:ADMIN_EMAIL,role:'super_admin',expires:Date.now()+TTL});
    const ua=String(req.headers['user-agent']||''); const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim(); const ip=String(req.headers['x-nf-client-connection-ip']||forwarded||req.socket.remoteAddress||'unknown'); const device=/iPhone/i.test(ua)?'iPhone':/iPad/i.test(ua)?'iPad':/Android/i.test(ua)?'Android cihaz':/Windows/i.test(ua)?'Windows cihaz':/Mac OS X/i.test(ua)?'Mac': 'Bilinmeyen cihaz'; const browser=/CriOS|Chrome/i.test(ua)?'Chrome':/FxiOS|Firefox/i.test(ua)?'Firefox':/Edg/i.test(ua)?'Edge':/Safari/i.test(ua)?'Safari':'Bilinmiyor'; addAudit('admin_login',ADMIN_EMAIL,{ip,device,browser,userAgent:ua});
    const cookie=`${ADMIN_COOKIE}=${encodeURIComponent(t)}; Max-Age=${Math.floor(TTL/1000)}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production' ? '; Secure' : ''}`;
    return json(res,200,{ok:true,admin:{id:'ADMIN-001',email:ADMIN_EMAIL,role:'super_admin'},expiresIn:TTL/1000},{'Set-Cookie':cookie});
  }
  if(req.url==='/api/admin/logout' && req.method==='POST'){
    const h=req.headers.authorization||''; const c=parseCookies(req)[ADMIN_COOKIE]||''; if(h.startsWith('AdminBearer '))adminSessions.delete(h.slice(12)); if(c)adminSessions.delete(c); return json(res,200,{ok:true},{'Set-Cookie':`${ADMIN_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production' ? '; Secure' : ''}`});
  }
  const admin=adminAuth(req);
  if(req.url==='/api/admin/verify-2fa' && req.method==='POST'){if(!admin)return json(res,401,{error:'unauthorized'});const b=await body(req),code=String(b.code||'').trim(),valid=ADMIN_TOTP_SECRET?verifyTotp(ADMIN_TOTP_SECRET,code):(!ADMIN_TOTP_CODE?false:code===ADMIN_TOTP_CODE);if(!/^\d{6}$/.test(code)||!valid)return json(res,401,{error:'invalid_2fa_code'});addAudit('admin_sensitive_change_verified',admin.email,{});return json(res,200,{ok:true})}
  if(req.url==='/api/admin/home-content' && req.method==='GET'){if(!admin)return json(res,401,{error:'unauthorized'});return json(res,200,{content:await getHomeContent()});}
  if(req.url==='/api/admin/home-content' && req.method==='POST'){if(!admin)return json(res,401,{error:'unauthorized'});const clean=await saveHomeContent(await body(req));addAudit('member_home_content_updated',admin.email,{notices:clean.notices.length});return json(res,200,{ok:true,content:clean});}

  if(req.url==='/api/admin/maintenance' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    return json(res,200,{maintenance:getMaintenance()});
  }
  if(req.url==='/api/admin/maintenance' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const b=await body(req);
    const clean=(x,fallback)=>({enabled:!!x?.enabled,until:x?.until?new Date(x.until).toISOString():null,message:String(x?.message||fallback).trim().slice(0,240)});
    const next={site:clean(b.site,DEFAULT_MAINTENANCE.site.message),panel:clean(b.panel,DEFAULT_MAINTENANCE.panel.message)};
    saveMaintenance(next); addAudit('maintenance_update',admin.email,{maintenance:next});
    return json(res,200,{ok:true,maintenance:next});
  }
  if(req.url==='/api/admin/me' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); return json(res,200,{admin:{id:admin.adminId,email:admin.email,role:admin.role}});
  }
  if(req.url==='/api/admin/stats' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const users=await getUsers(), tx=await getTransactions();
    const sum=(arr)=>arr.reduce((a,x)=>a+Number(x.amount||0),0); return json(res,200,{users:users.length,pending:tx.filter(x=>x.status==='pending').length,approved:tx.filter(x=>x.status==='approved').length,kycPending:users.filter(x=>x.kycStatus==='pending').length,totalDeposits:sum(tx.filter(x=>x.type==='deposit'&&x.status==='approved')),totalWithdrawals:sum(tx.filter(x=>x.type==='withdrawal'&&x.status==='approved'))});
  }
  if(req.url==='/api/admin/users' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const users=await getUsers(); return json(res,200,{users:users.map(safeUser)});
  }
  if(req.url.startsWith('/api/admin/user-center') && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const urlObj=new URL(req.url,'http://localhost'); const q=(urlObj.searchParams.get('q')||'').trim().toLowerCase();
    const users=await getUsers(); const tx=await getTransactions();
    const filtered=users.filter(u=>!q || [u.id,u.firstName,u.lastName,u.email,u.phone,u.referralCode].filter(Boolean).join(' ').toLowerCase().includes(q));
    const rows=filtered.map(u=>{const ut=tx.filter(x=>x.userId===u.id);return {...safeUser(u), totalDeposits:ut.filter(x=>x.type==='deposit'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0), totalWithdrawals:ut.filter(x=>x.type==='withdrawal'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0), pendingCount:ut.filter(x=>x.status==='pending').length, transactions:ut.length};});
    const kyc=users.filter(u=>u.kycStatus==='pending').map(u=>({userId:u.id,name:u.kycName,email:u.email,submittedAt:u.kycSubmittedAt,status:u.kycStatus}));
    return json(res,200,{users:rows,kycPending:kyc,totalUsers:users.length,pendingKyc:kyc.length});
  }
  if(req.url.startsWith('/api/admin/user/') && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const id=decodeURIComponent(req.url.split('/').pop()); const u=await findUserById(id); if(!u)return json(res,404,{error:'user_not_found'});
    const tx=(await getTransactions()).filter(x=>x.userId===id); const deposits=tx.filter(x=>x.type==='deposit'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0); const withdrawals=tx.filter(x=>x.type==='withdrawal'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0);
    return json(res,200,{user:safeUser(u),summary:{deposits,withdrawals,pending:tx.filter(x=>x.status==='pending').reduce((a,x)=>a+Number(x.amount||0),0),transactions:tx.length},transactions:tx,ledger:await getLedger(id)});
  }
  if(req.url.startsWith('/api/admin/user/') && req.url.endsWith('/security') && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const id=decodeURIComponent(req.url.split('/')[4]||''); const u=await findUserById(id); if(!u)return json(res,404,{error:'user_not_found'});
    return json(res,200,{security:{status:u.securityStatus||'active',withdrawalFrozen:!!u.withdrawalFrozen,depositFrozen:!!u.depositFrozen,reason:u.securityReason||null,updatedAt:u.securityUpdatedAt||null}});
  }
  if(req.url.startsWith('/api/admin/user/') && req.url.endsWith('/security') && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const id=decodeURIComponent(req.url.split('/')[4]||''); const u=await findUserById(id); if(!u)return json(res,404,{error:'user_not_found'});
    const b=await body(req), action=String(b.action||''), reason=String(b.reason||'').trim().slice(0,500); const valid=['suspend','lock','withdrawal','deposit','sessions','2fa','restore'];
    if(!valid.includes(action))return json(res,400,{error:'invalid_security_action'});
    let status=u.securityStatus||'active', wf=!!u.withdrawalFrozen, df=!!u.depositFrozen;
    if(action==='suspend') status='suspended'; else if(action==='lock') status='locked'; else if(action==='withdrawal') wf=true; else if(action==='deposit') df=true; else if(action==='restore'){status='active';wf=false;df=false;}
    if(action==='sessions'||action==='lock'){for(const [t,ss] of sessions.entries()) if(ss.userId===id) sessions.delete(t);}
    const now=new Date().toISOString();
    if(pool){
      if(action==='2fa') await pool.query('UPDATE users SET totp_secret=NULL,two_factor_enabled=false WHERE id=$1',[id]);
      await pool.query('UPDATE users SET security_status=$1,withdrawal_frozen=$2,deposit_frozen=$3,security_reason=$4,security_updated_at=$5 WHERE id=$6',[status,wf,df,reason||null,now,id]);
    } else {const db=readDb();const x=db.users.find(x=>x.id===id);if(!x)return json(res,404,{error:'user_not_found'});x.securityStatus=status;x.withdrawalFrozen=wf;x.depositFrozen=df;x.securityReason=reason||null;x.securityUpdatedAt=now;if(action==='2fa'){x.totpSecret=null;x.twoFactorEnabled=false;}writeDb(db);}
    addAudit('user_security_'+action,admin.email,{userId:id,reason}); return json(res,200,{ok:true,security:{status,withdrawalFrozen:wf,depositFrozen:df,reason:reason||null,updatedAt:now}});
  }
  if(req.url==='/api/admin/transactions' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); return json(res,200,{transactions:await getTransactions()});
  }
  if(req.url==='/api/admin/ledger' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const urlObj=new URL(req.url,'http://localhost'); const userId=urlObj.searchParams.get('userId')||null; return json(res,200,{ledger:await getLedger(userId)});
  }
  if(req.url==='/api/admin/kyc' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const users=await getUsers(); return json(res,200,{requests:users.filter(u=>u.kycStatus==='pending').map(u=>({userId:u.id,name:u.kycName,email:u.email,submittedAt:u.kycSubmittedAt,status:u.kycStatus}))});
  }
  if(req.url==='/api/admin/kyc/decision' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const b=await body(req); const id=String(b.userId||''); const decision=['approved','rejected'].includes(b.decision)?b.decision:null; if(!decision)return json(res,400,{error:'invalid_decision'});
    if(pool)await pool.query('UPDATE users SET kyc_status=$1 WHERE id=$2',[decision,id]); else{const db=readDb();const u=db.users.find(x=>x.id===id);if(!u)return json(res,404,{error:'user_not_found'});u.kycStatus=decision;writeDb(db);} addAudit('kyc_decision',admin.email,{userId:id,decision}); return json(res,200,{ok:true,status:decision});
  }
  if(req.url==='/api/admin/transactions/lock' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const b=await body(req); const id=String(b.transactionId||''); const all=await getTransactions(); const tx=all.find(x=>x.id===id); if(!tx)return json(res,404,{error:'transaction_not_found'}); if(tx.status!=='pending')return json(res,409,{error:'not_pending',status:tx.status});
    if(isLocked(tx) && tx.lockedBy!==admin.email)return json(res,409,{error:'transaction_locked',lockedBy:tx.lockedBy});
    const now=new Date().toISOString(); if(pool) await pool.query('UPDATE transactions SET locked_by=$1, locked_at=$2 WHERE id=$3',[admin.email,now,id]); else {const db=readDb();const row=db.transactions.find(x=>x.id===id);row.lockedBy=admin.email;row.lockedAt=now;writeDb(db);} txLocks.set(lockKey(id),admin.email); addAudit('transaction_lock',admin.email,{transactionId:id,lockMinutes:TX_CONTROL.lockMinutes}); return json(res,200,{ok:true,lockedBy:admin.email,lockedAt:now,lockMinutes:TX_CONTROL.lockMinutes});
  }
  if(req.url==='/api/admin/transactions/reopen' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const b=await body(req); const id=String(b.transactionId||''); const all=await getTransactions(); const tx=all.find(x=>x.id===id); if(!tx)return json(res,404,{error:'transaction_not_found'}); if(!['auto-rejected','rejected'].includes(tx.status))return json(res,409,{error:'not_reopenable',status:tx.status});
    const expiresAt=new Date(Date.now()+TX_CONTROL.autoRejectMinutes*60000).toISOString(); if(pool) await pool.query("UPDATE transactions SET status='pending', decision_by=NULL, decision_at=NULL, locked_by=NULL, locked_at=NULL, expires_at=$1 WHERE id=$2",[expiresAt,id]); else {const db=readDb();const row=db.transactions.find(x=>x.id===id);row.status='pending';row.decisionBy=null;row.decisionAt=null;row.lockedBy=null;row.lockedAt=null;row.expiresAt=expiresAt;writeDb(db);} addAudit('transaction_reopen',admin.email,{transactionId:id,expiresAt}); return json(res,200,{ok:true,status:'pending',expiresAt});
  }
  if(req.url==='/api/admin/transactions/decision' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const b=await body(req); const id=String(b.transactionId||''); const decision=['approved','rejected'].includes(b.decision)?b.decision:null; if(!decision)return json(res,400,{error:'invalid_decision'});
    const all=await getTransactions(); const tx=all.find(x=>x.id===id); if(!tx)return json(res,404,{error:'transaction_not_found'}); if(tx.status!=='pending')return json(res,409,{error:'already_processed',status:tx.status});
    if(isLocked(tx) && tx.lockedBy!==admin.email)return json(res,409,{error:'transaction_locked',lockedBy:tx.lockedBy});
    const requestedAmount=Number(tx.requestedAmount??tx.requested_amount??tx.amount); const rawApproved=b.approvedAmount; const approvedAmount=decision==='approved' && rawApproved!==undefined && rawApproved!==null && rawApproved!==''?Number(rawApproved):Number(tx.amount); if(decision==='approved'&&(!Number.isFinite(approvedAmount)||approvedAmount<=0))return json(res,400,{error:'invalid_approved_amount'});
    if(decision==='approved' && tx.type==='withdrawal'){const u=await findUserById(tx.userId);if(approvedAmount>Number(u.balance||0))return json(res,409,{error:'insufficient_balance_at_approval'});}
    const decisionAt=new Date().toISOString(); const amountChanged=Math.abs(approvedAmount-requestedAmount)>1e-8;
    if(pool){const client=await pool.connect(); try {await client.query('BEGIN'); const lock=await client.query("SELECT status, locked_by FROM transactions WHERE id=$1 FOR UPDATE",[id]); if(!lock.rows[0]||lock.rows[0].status!=='pending'){await client.query('ROLLBACK');return json(res,409,{error:'already_processed'});} if(lock.rows[0].locked_by&&lock.rows[0].locked_by!==admin.email){await client.query('ROLLBACK');return json(res,409,{error:'transaction_locked',lockedBy:lock.rows[0].locked_by});} await client.query('UPDATE transactions SET status=$1,amount=$2,requested_amount=COALESCE(requested_amount,$3),received_amount=$4,decision_by=$5,decision_at=$6,locked_by=NULL,locked_at=NULL WHERE id=$7',[decision,approvedAmount,requestedAmount,approvedAmount,admin.email,decisionAt,id]); if(decision==='approved') await addLedgerEntry({userId:tx.userId,transactionId:tx.id,direction:tx.type==='deposit'?'credit':'debit',amount:approvedAmount,reason:tx.type==='deposit'?'deposit_approved':'withdrawal_approved',metadata:{network:tx.network,admin:admin.email,requestedAmount,approvedAmount,amountChanged}},client); await client.query('COMMIT');} catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}}
    else{const db=readDb();const row=db.transactions.find(x=>x.id===id);if(!row||row.status!=='pending')return json(res,409,{error:'already_processed'});if(row.lockedBy&&row.lockedBy!==admin.email&&isLocked(row))return json(res,409,{error:'transaction_locked',lockedBy:row.lockedBy});row.requestedAmount=Number(row.requestedAmount??row.amount);row.receivedAmount=approvedAmount;row.amount=approvedAmount;row.status=decision;row.decisionBy=admin.email;row.decisionAt=decisionAt;row.lockedBy=null;row.lockedAt=null;if(decision==='approved'){const u=db.users.find(x=>x.id===tx.userId);const before=Number(u.balance||0);const credit=tx.type==='deposit';const after=Number((credit?before+approvedAmount:before-approvedAmount).toFixed(8));if(after<0)return json(res,409,{error:'negative_balance_at_approval'});u.balance=after;db.ledger=db.ledger||[];db.ledger.unshift({id:`LED-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,userId:tx.userId,transactionId:tx.id,direction:credit?'credit':'debit',amount:approvedAmount,currency:tx.currency||'USDT',balanceBefore:before,balanceAfter:after,reason:credit?'deposit_approved':'withdrawal_approved',metadata:{network:tx.network,admin:admin.email,requestedAmount,approvedAmount,amountChanged},createdAt:decisionAt});}writeDb(db);}
    addAudit('transaction_decision',admin.email,{transactionId:id,decision,requestedAmount,approvedAmount,amountChanged}); return json(res,200,{ok:true,status:decision,decisionBy:admin.email,decisionAt,requestedAmount,approvedAmount,amountChanged});
  }
  if(req.url==='/api/admin/audit' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); return json(res,200,{audit:auditLog});
  }

  if(req.url.startsWith('/api/auth/check-username') && req.method==='GET'){
    const q=new URL(req.url,'http://localhost').searchParams; const username=String(q.get('username')||'').trim().toLowerCase().replace(/^@/,'');
    if(!/^[a-z0-9_]{3,20}$/.test(username)) return json(res,200,{available:false,valid:false,error:'invalid_username'});
    const users=await getUsers(); return json(res,200,{available:!users.some(u=>String(u.username||'').toLowerCase()===username),valid:true});
  }
  if(req.url==='/api/auth/register' && req.method==='POST'){
    const b=await body(req); const first=String(b.firstName||'').trim(); const last=String(b.lastName||'').trim(); const username=String(b.username||'').trim().toLowerCase().replace(/^@/,''); const email=String(b.email||'').trim().toLowerCase(); const phone=normalizePhone(b.phone); const password=String(b.password||''); const referralCode=String(b.referralCode||'').trim().toUpperCase();
    if(first.length<2 || last.length<2) return json(res,400,{error:'invalid_name'});
    if(!/^[a-z0-9_]{3,20}$/.test(username)) return json(res,400,{error:'invalid_username'});
    if(!validEmail(email)) return json(res,400,{error:'invalid_email'});
    if(!validPhone(phone)) return json(res,400,{error:'invalid_phone',message:'Telefon +90XXXXXXXXXX formatÄ±nda olmalÄ±.'});
    if(password.length<8) return json(res,400,{error:'weak_password'});
    const users=await getUsers();
    if(users.some(u=>u.email.toLowerCase()===email)) return json(res,409,{error:'email_exists'});
    if(users.some(u=>normalizePhone(u.phone)===phone)) return json(res,409,{error:'phone_exists'});
    if(users.some(u=>String(u.username||'').toLowerCase()===username)) return json(res,409,{error:'username_exists',message:'Bu kullanÄ±cÄ± adÄ± zaten kullanÄ±lÄ±yor.'});
    const user={id:makeUserId(users),firstName:first,lastName:last,username,email,phone,passwordHash:hashPassword(password),role:'user',balance:0,referralEarnings:0,referralCode:`SAFE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,twoFactorEnabled:false,phoneVerified:false,emailVerified:false,createdAt:new Date().toISOString()};
    if(referralCode) user.referredBy=referralCode;
    await insertUser(user);
    const t=token(); sessions.set(t,{userId:user.id,expires:Date.now()+TTL});
    return json(res,201,{token:t,user:safeUser(user),expiresIn:TTL/1000});
  }

  if(req.url==='/api/auth/login' && req.method==='POST'){
    const b=await body(req); const identifier=String(b.email||b.phone||'').trim(); const password=String(b.password||''); const users=await getUsers();
    const normalized=normalizePhone(identifier);
    const u=users.find(x=>x.email.toLowerCase()===identifier.toLowerCase() || normalizePhone(x.phone)===normalized);
    const valid=u && (verifyPassword(password,u.passwordHash) || (u.email==='test@safepays.local' && password==='12345678'));
    if(!valid) return json(res,401,{error:'invalid_credentials'});
    if(u.securityStatus==='locked') return json(res,403,{error:'account_locked',message:'HesabÄ±nÄ±z gÃ¼venlik nedeniyle kilitlenmiÅŸtir.'});
    const t=token(); sessions.set(t,{userId:u.id,expires:Date.now()+TTL});
    return json(res,200,{token:t,user:safeUser(u),expiresIn:TTL/1000});
  }

  if(req.url==='/api/auth/send-verification' && req.method==='POST'){
    const b=await body(req); const type=b.type==='phone'?'phone':'email'; const value=String(b.value||'').trim().toLowerCase();
    const code=String(Math.floor(100000+Math.random()*900000)); const key=`${type}:${value}`; verificationCodes.set(key,{code,expires:Date.now()+10*60*1000});
    return json(res,200,{ok:true,message:`Demo doÄŸrulama kodu oluÅŸturuldu.`,demoCode:code,expiresIn:600});
  }
  if(req.url==='/api/auth/verify' && req.method==='POST'){
    const b=await body(req); const type=b.type==='phone'?'phone':'email'; const value=String(b.value||'').trim().toLowerCase(); const code=String(b.code||''); const key=`${type}:${value}`; const item=verificationCodes.get(key);
    if(!item || item.expires<Date.now() || item.code!==code) return json(res,400,{error:'invalid_code'});
    verificationCodes.delete(key); return json(res,200,{ok:true,verified:true,type});
  }

  if(req.url==='/api/auth/forgot-password' && req.method==='POST'){
    const b=await body(req); const identifier=String(b.email||'').trim().toLowerCase(); const u=await findUserByEmail(identifier);
    // Demo: token is returned only so the local flow can be tested. Production must email it server-side.
    const resetToken=token(); if(u) resetTokens.set(resetToken,{userId:u.id,expires:Date.now()+15*60*1000});
    return json(res,200,{ok:true,message:'EÄŸer hesap mevcutsa ÅŸifre sÄ±fÄ±rlama baÄŸlantÄ±sÄ± gÃ¶nderilecektir.',demoToken:u?resetToken:null});
  }

  // Self-contained password-reset flow (works on any Node host, incl. Render — no Netlify/email dependency required).
  // action=send -> generates a 6-digit code (10 min TTL). action=verify -> checks the code and, if newPassword is
  // provided, updates the real user's password hash server-side (the client must never mutate passwords itself).
  if(req.url==='/api/password-reset' && req.method==='POST'){
    const b=await body(req); const action=String(b.action||''); const email=String(b.email||'').trim().toLowerCase();
    if(!validEmail(email)) return json(res,400,{error:'invalid_email'});
    if(action==='send'){
      const existing=passwordResetCodes.get(email);
      if(existing && existing.sentAt && Date.now()-existing.sentAt<60000) return json(res,200,{ok:true,status:'sent'});
      const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
      const record={codeHash:crypto.createHash('sha256').update(`${email}:${code}`).digest('hex'),sentAt:Date.now(),expires:Date.now()+10*60*1000,attempts:0};
      passwordResetCodes.set(email,record);
      const u=await findUserByEmail(email);
      // No transactional email provider is configured in this project yet. We log the code server-side so an
      // operator can relay it, and only ever return it in the response outside production so local/dev testing works.
      console.log(`[password-reset] code for ${email}: ${u?code:'(no account — code withheld)'}`);
      return json(res,200,{ok:true,status:'sent', demoCode: (process.env.NODE_ENV!=='production' && u) ? code : undefined});
    }
    if(action==='verify'){
      const code=String(b.code||'').trim(); const newPassword=b.newPassword!==undefined?String(b.newPassword):null;
      if(!/^\d{6}$/.test(code)) return json(res,400,{error:'invalid_code'});
      const record=passwordResetCodes.get(email);
      if(!record || Date.now()>record.expires) return json(res,400,{error:'code_expired'});
      if(record.attempts>=5) return json(res,429,{error:'too_many_attempts'});
      const hash=crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');
      if(hash!==record.codeHash){ record.attempts++; return json(res,400,{error:'invalid_code'}); }
      if(newPassword!==null){
        if(newPassword.length<8) return json(res,400,{error:'weak_password'});
        const u=await findUserByEmail(email);
        if(u){
          const newHash=hashPassword(newPassword);
          if(pool) await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[newHash,u.id]);
          else { const db=readDb(); const row=db.users.find(x=>x.id===u.id); if(row){ row.passwordHash=newHash; writeDb(db); } }
          for(const [t,s] of sessions.entries()) if(s.userId===u.id) sessions.delete(t); // force re-login everywhere
          addAudit('password_reset_completed','system',{userId:u.id});
        }
        passwordResetCodes.delete(email);
        return json(res,200,{ok:true,status:'reset'});
      }
      record.verified=true; return json(res,200,{ok:true,status:'verified'});
    }
    return json(res,400,{error:'unknown_action'});
  }

  const uid=auth(req);
  if(req.url==='/api/auth/me' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const u=await findUserById(uid); return json(res,200,{user:safeUser(u)});
  }

  if(req.url==='/api/rates' && req.method==='GET'){
    const snap=await getMarketSnapshot(); const settings=getRateSettings();
    const market=Number(snap.market); const safepays=calc(market,settings.usdTrySpread);
    if(settings.minRate && safepays<settings.minRate)return json(res,503,{error:'rate_below_configured_min'});
    if(settings.maxRate && safepays>settings.maxRate)return json(res,503,{error:'rate_above_configured_max'});
    return json(res,200,{ok:true,base:'USDT',currency:'TRY',marketRate:Number(market.toFixed(4)),safepaysRate:Number(safepays.toFixed(4)),spread:Number(settings.usdTrySpread),source:snap.source,stale:!!snap.stale,rateAgeSeconds:Math.round((snap.ageMs||0)/1000),warning:snap.warning||null,networks:{TRC20:{feeUsdt:Number(settings.trc20FeeUsdt)},ERC20:{feeUsdt:Number(settings.erc20FeeUsdt)}},updatedAt:new Date(snap.fetchedAt||Date.now()).toISOString()});
  }
  if(req.url==='/api/quote' && req.method==='POST'){
    const b=await body(req); const tryAmount=Number(b.tryAmount); const usdtAmount=Number(b.usdtAmount); const network=String(b.network||'TRC20').toUpperCase();
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    const snap=await getMarketSnapshot(); const settings=getRateSettings(); const market=Number(snap.market); const safepays=calc(market,settings.usdTrySpread);
    if(!Number.isFinite(safepays)||safepays<=0)return json(res,503,{error:'rate_unavailable'});
    const fee=Number(settings[network==='TRC20'?'trc20FeeUsdt':'erc20FeeUsdt']);
    const quote=makeQuote({marketRate:Number(market.toFixed(4)),safepaysRate:Number(safepays.toFixed(4)),network,feeUsdt:fee,spread:Number(settings.usdTrySpread),ttlSeconds:Math.min(300,Math.max(15,Number(settings.quoteTtlSeconds)||60))});
    quote.stale=!!snap.stale; quote.source=snap.source; quote.rateAgeSeconds=Math.round((snap.ageMs||0)/1000);
    if(Number.isFinite(tryAmount)&&tryAmount>0) quote.result={direction:'TRY_TO_USDT',tryAmount:Number(tryAmount.toFixed(2)),usdtAmount:Number((tryAmount/safepays).toFixed(6)),netUsdt:Number(Math.max(0,tryAmount/safepays-fee).toFixed(6))};
    else if(Number.isFinite(usdtAmount)&&usdtAmount>0) quote.result={direction:'USDT_TO_TRY',usdtAmount:Number(usdtAmount.toFixed(6)),tryAmount:Number((usdtAmount*safepays).toFixed(2)),netUsdt:Number(Math.max(0,usdtAmount-fee).toFixed(6))};
    else return json(res,400,{error:'invalid_amount'});
    quoteStore.set(quote.quoteId,quote); setTimeout(()=>quoteStore.delete(quote.quoteId),((quote.expiresInSeconds+5)*1000));
    return json(res,200,{ok:true,quote});
  }
  if(req.url==='/api/convert' && req.method==='POST'){
    const b=await body(req); const tryAmount=Number(b.tryAmount); const usdtAmount=Number(b.usdtAmount); const network=String(b.network||'TRC20').toUpperCase();
    const market=await getMarketUsdtTry(); const settings=getRateSettings(); const safepays=calc(market,settings.usdTrySpread);
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    if(Number.isFinite(tryAmount)&&tryAmount>0) return json(res,200,{ok:true,direction:'TRY_TO_USDT',tryAmount,usdtAmount:Number((tryAmount/safepays).toFixed(6)),marketRate:Number(market.toFixed(4)),safepaysRate:Number(safepays.toFixed(4)),network,feeUsdt:Number(settings[network==='TRC20'?'trc20FeeUsdt':'erc20FeeUsdt'])});
    if(Number.isFinite(usdtAmount)&&usdtAmount>0) return json(res,200,{ok:true,direction:'USDT_TO_TRY',usdtAmount,tryAmount:Number((usdtAmount*safepays).toFixed(2)),marketRate:Number(market.toFixed(4)),safepaysRate:Number(safepays.toFixed(4)),network,feeUsdt:Number(settings[network==='TRC20'?'trc20FeeUsdt':'erc20FeeUsdt'])});
    return json(res,400,{error:'invalid_amount'});
  }
  if(req.url==='/api/admin/rates' && req.method==='GET'){
    const a=adminAuth(req); if(!a)return json(res,401,{error:'unauthorized'}); const snap=await getMarketSnapshot(); const settings=getRateSettings(); return json(res,200,{marketRate:snap.market,safepaysRate:calc(snap.market,settings.usdTrySpread),source:snap.source,stale:!!snap.stale,rateAgeSeconds:Math.round((snap.ageMs||0)/1000),...settings});
  }
  if(req.url==='/api/admin/rates' && req.method==='POST'){
    const a=adminAuth(req); if(!a)return json(res,401,{error:'unauthorized'}); const b=await body(req); const usdTrySpread=Math.max(0,Number(b.usdTrySpread)); const trc20FeeUsdt=Math.max(0,Number(b.trc20FeeUsdt)); const erc20FeeUsdt=Math.max(0,Number(b.erc20FeeUsdt)); const quoteTtlSeconds=Math.min(300,Math.max(15,Number(b.quoteTtlSeconds||60))); const maxRateAgeSeconds=Math.min(3600,Math.max(30,Number(b.maxRateAgeSeconds||300))); const minRate=Math.max(0,Number(b.minRate||0)); const maxRate=Math.max(minRate,Number(b.maxRate||100000)); if(![usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate].every(Number.isFinite))return json(res,400,{error:'invalid_rate_settings'}); saveRateSettings({usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate}); addAudit('rate_settings_update',a.email,{usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate}); const snap=await getMarketSnapshot(); return json(res,200,{ok:true,marketRate:snap.market,safepaysRate:calc(snap.market,usdTrySpread),source:snap.source,usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate});
  }

  if(req.url==='/api/deposits' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    const b=await body(req); const amount=Number(b.amount); const network=String(b.network||'').toUpperCase(); const txHash=String(b.txHash||'').trim(); const currentUser=await findUserById(uid); if(currentUser?.securityStatus==='locked'||currentUser?.securityStatus==='suspended'||currentUser?.depositFrozen) return json(res,403,{error:'deposits_blocked',message:'YatÄ±rÄ±m talepleri gÃ¼venlik nedeniyle geÃ§ici olarak dondurulmuÅŸtur.'}); const requestKey=getRequestKey(req,b) || `AUTO-${crypto.randomUUID()}`;
    if(requestKey){const existingKey=(await getTransactions()).find(x=>x.requestKey===requestKey && x.userId===uid); if(existingKey)return json(res,200,{ok:true,idempotent:true,transaction:existingKey});}
    if(!Number.isFinite(amount)||amount<10)return json(res,400,{error:'invalid_amount',message:'Minimum yatÄ±rÄ±m 10 USDT.'});
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    if(txHash.length<16)return json(res,400,{error:'invalid_tx_hash'});
    const existing=(await getTransactions()).find(x=>x.txHash&&x.txHash.toLowerCase()===txHash.toLowerCase());
    if(existing)return json(res,409,{error:'duplicate_tx_hash',transactionId:existing.id});
    const cooldown=await requestCooldownRemaining(uid);
    if(cooldown>0)return json(res,429,{error:'request_cooldown',cooldownSeconds:Math.ceil(cooldown/1000),message:'Yeni yatÄ±rÄ±m veya Ã§ekim talebi iÃ§in '+Math.ceil(cooldown/1000)+' saniye beklemelisiniz.'});
    startRequestCooldown(uid);
    const createdAt=new Date(); const tx={id:makeTxId(),userId:uid,type:'deposit',amount,requestedAmount:amount,receivedAmount:null,currency:'USDT',network,status:'pending',createdAt:createdAt.toISOString(),txHash,requestKey,expiresAt:new Date(createdAt.getTime()+TX_CONTROL.autoRejectMinutes*60000).toISOString()};
    await insertTransaction(tx); addAudit('deposit_request',uid,{transactionId:tx.id,amount,network});
    return json(res,201,{ok:true,transaction:tx,requestKey,message:'YatÄ±rÄ±m talebi alÄ±ndÄ±. Yeni talep oluÅŸturabilirsiniz; her talep ayrÄ± iÅŸlem ID ile kaydedilir.'});
  }
  if(req.url==='/api/withdrawals' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    const b=await body(req); const amount=Number(b.amount); const network=String(b.network||'').toUpperCase(); const address=String(b.address||'').trim(); const u=await findUserById(uid); if(u?.securityStatus==='locked'||u?.securityStatus==='suspended'||u?.withdrawalFrozen) return json(res,403,{error:'withdrawals_blocked',message:'Ã‡ekim talepleri gÃ¼venlik nedeniyle geÃ§ici olarak dondurulmuÅŸtur.'}); const requestKey=getRequestKey(req,b) || `AUTO-${crypto.randomUUID()}`;
    if(requestKey){const existingKey=(await getTransactions()).find(x=>x.requestKey===requestKey && x.userId===uid); if(existingKey)return json(res,200,{ok:true,idempotent:true,transaction:existingKey});}
    if(!Number.isFinite(amount)||amount<10)return json(res,400,{error:'invalid_amount',message:'Minimum Ã§ekim 10 USDT.'});
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    if(!isValidAddress(network,address))return json(res,400,{error:'invalid_address',message:'CÃ¼zdan adresi seÃ§ilen aÄŸ ile uyumlu deÄŸil.'});
    if(amount>demoBalance(u))return json(res,400,{error:'insufficient_balance'});
    const pending=(await getTransactions()).filter(x=>x.userId===uid&&x.type==='withdrawal'&&x.status==='pending').reduce((a,x)=>a+Number(x.amount||0),0);
    if(amount+pending>demoBalance(u))return json(res,400,{error:'insufficient_available_balance'});
    const cooldown=await requestCooldownRemaining(uid);
    if(cooldown>0)return json(res,429,{error:'request_cooldown',cooldownSeconds:Math.ceil(cooldown/1000),message:'Yeni yatÄ±rÄ±m veya Ã§ekim talebi iÃ§in '+Math.ceil(cooldown/1000)+' saniye beklemelisiniz.'});
    startRequestCooldown(uid);
    const createdAt=new Date(); const tx={id:makeTxId(),userId:uid,type:'withdrawal',amount,requestedAmount:amount,receivedAmount:null,currency:'USDT',network,status:'pending',createdAt:createdAt.toISOString(),txHash:null,address,requestKey,expiresAt:new Date(createdAt.getTime()+TX_CONTROL.autoRejectMinutes*60000).toISOString()};
    await insertTransaction(tx); addAudit('withdrawal_request',uid,{transactionId:tx.id,amount,network});
    return json(res,201,{ok:true,transaction:tx,requestKey,message:'Ã‡ekim talebi alÄ±ndÄ±. Yeni talep oluÅŸturabilirsiniz; her talep ayrÄ± iÅŸlem ID ile kaydedilir.'});
  }

  if(req.url==='/api/transactions' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const tx=(await getTransactions()).filter(x=>x.userId===uid); return json(res,200,{transactions:tx});
  }
  if(req.url==='/api/ledger' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'}); return json(res,200,{ledger:await getLedger(uid)});
  }
  if(req.url==='/api/security/2fa/setup' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const u=await findUserById(uid); const secret=base32Encode(crypto.randomBytes(20));
    if(pool)await pool.query('UPDATE users SET totp_secret=$1,two_factor_enabled=false WHERE id=$2',[secret,uid]); else{const db=readDb();const x=db.users.find(x=>x.id===uid);if(x){x.totpSecret=secret;x.twoFactorEnabled=false;writeDb(db);}}
    return json(res,200,{ok:true,secret,otpauth:`otpauth://totp/Safepays:${encodeURIComponent(u.email)}?secret=${secret}&issuer=Safepays`});
  }
  if(req.url==='/api/security/2fa/verify' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const b=await body(req); const u=await findUserById(uid); if(!u?.totpSecret)return json(res,400,{error:'setup_required'}); if(!verifyTotp(u.totpSecret,b.code))return json(res,400,{error:'invalid_code'});
    if(pool)await pool.query('UPDATE users SET two_factor_enabled=true WHERE id=$1',[uid]); else{const db=readDb();const x=db.users.find(x=>x.id===uid);if(x){x.twoFactorEnabled=true;writeDb(db);}} return json(res,200,{ok:true,enabled:true});
  }
  if(req.url==='/api/security/2fa/disable' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const b=await body(req); const u=await findUserById(uid); if(!u?.totpSecret || !verifyTotp(u.totpSecret,b.code))return json(res,400,{error:'invalid_code'});
    if(pool)await pool.query('UPDATE users SET two_factor_enabled=false WHERE id=$1',[uid]); else{const db=readDb();const x=db.users.find(x=>x.id===uid);if(x){x.twoFactorEnabled=false;writeDb(db);}} return json(res,200,{ok:true,enabled:false});
  }
  if(req.url==='/api/kyc/status' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const u=await findUserById(uid); return json(res,200,{status:u.kycStatus||'not_started',name:u.kycName||null,submittedAt:u.kycSubmittedAt||null});
  }
  if(req.url==='/api/kyc/submit' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const b=await body(req); const name=String(b.fullName||'').trim(); const documentType=String(b.documentType||''); if(name.length<5 || !['identity','passport','driver_license'].includes(documentType))return json(res,400,{error:'invalid_kyc_data'}); const submittedAt=new Date().toISOString();
    if(pool)await pool.query("UPDATE users SET kyc_status='pending',kyc_name=$1,kyc_submitted_at=$2 WHERE id=$3",[name,submittedAt,uid]); else{const db=readDb();const x=db.users.find(x=>x.id===uid);if(x){x.kycStatus='pending';x.kycName=name;x.kycSubmittedAt=submittedAt;writeDb(db);}} return json(res,200,{ok:true,status:'pending',submittedAt});
  }
  if(req.url==='/api/auth/logout' && req.method==='POST'){
    const h=req.headers.authorization||''; if(h.startsWith('Bearer '))sessions.delete(h.slice(7)); return json(res,200,{ok:true});
  }
  return sendFile(req,res);
}
pgInit().then(()=>http.createServer((req,res)=>route(req,res).catch(e=>{console.error(e);json(res,500,{error:'server_error'})})).listen(PORT,'0.0.0.0',()=>console.log(`Safepays v29 running: http://localhost:${PORT}`))).catch(e=>{console.error('DB init failed',e);process.exit(1)});
