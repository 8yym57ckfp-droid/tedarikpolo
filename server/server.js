const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let Pool = null;
try { ({ Pool } = require('pg')); } catch (_) { /* PostgreSQL is optional for local development. */ }
const { getMarketUsdtTry, getMarketSnapshot, calc, makeQuote } = require('./rates');
const { verifyUsdtTransfer } = require('./chain-verification');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const DATA = path.join(DATA_DIR, 'db.json');
const MAINTENANCE_DATA = path.join(DATA_DIR, 'maintenance.json');
const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_POSTGRES = !!DATABASE_URL && !!Pool;
const pool = USE_POSTGRES ? new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized:false } }) : null;
if(process.env.NODE_ENV==='production'&&!pool){throw new Error('A persistent PostgreSQL DATABASE_URL is required in production.');}
const TTL = Number(process.env.SESSION_TTL_SECONDS || 3600) * 1000;
const sessions = new Map();
const resetTokens = new Map();
const passwordResetCodes = new Map(); // email -> {codeHash, expires, attempts, verified}
const verificationCodes = new Map();
const adminSessions = new Map();
const ownerSessions = new Map();
const auditLog = [];
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || '';
const ADMIN_TOTP_CODE = process.env.ADMIN_TOTP_CODE || '';
const TEAM_ADMIN_EMAIL = process.env.TEAM_ADMIN_EMAIL || '';
const TEAM_ADMIN_PASSWORD = process.env.TEAM_ADMIN_PASSWORD || '';
const TEAM_ADMIN_TOTP_SECRET = process.env.TEAM_ADMIN_TOTP_SECRET || '';
const ADMIN_COOKIE = 'sp_admin_session';
const OWNER_COOKIE = 'sp_owner_session';
const DEFAULT_RATE_SETTINGS = { usdTrySpread: 1, trc20FeeUsdt: 0, erc20FeeUsdt: 0, quoteTtlSeconds: 60, maxRateAgeSeconds: 300, minRate: 0, maxRate: 100000 };
const TX_CONTROL = { autoRejectMinutes: 30, lockMinutes: 5, largeApprovalThreshold: 10000 };
const txLocks = new Map();
const idempotencyCache = new Map();
const quoteStore = new Map();
const requestCooldowns = new Map();
const REQUEST_COOLDOWN_MS = 120000;
const DEFAULT_MAINTENANCE = {
  site: { enabled:false, until:null, message:'Sitemiz güncelleniyor. Daha iyi bir deneyim için kısa bir bakım çalışması yapıyoruz.' },
  panel: { enabled:false, until:null, message:'Yönetim paneli güncelleniyor. Ekip erişimi bakım tamamlandığında yeniden açılacaktır.' }
};
async function getMaintenance(){
  if(pool){const r=await pool.query('SELECT content FROM site_content WHERE id=$1',['maintenance']);const raw=r.rows[0]?.content||{};return {site:{...DEFAULT_MAINTENANCE.site,...(raw.site||{})},panel:{...DEFAULT_MAINTENANCE.panel,...(raw.panel||{})}};}
  try{ if(fs.existsSync(MAINTENANCE_DATA)){ const raw=JSON.parse(fs.readFileSync(MAINTENANCE_DATA,'utf8')); return {site:{...DEFAULT_MAINTENANCE.site,...(raw.site||{})},panel:{...DEFAULT_MAINTENANCE.panel,...(raw.panel||{})}}; } }catch(_){ }
  return JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE));
}
async function saveMaintenance(next){if(pool){await pool.query('INSERT INTO site_content (id,content,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()',['maintenance',JSON.stringify(next)]);return next;}fs.writeFileSync(MAINTENANCE_DATA,JSON.stringify(next,null,2));return next;}

async function getRateSettings(){
  if(pool){const r=await pool.query('SELECT content FROM site_content WHERE id=$1',['rate-settings']);return {...DEFAULT_RATE_SETTINGS,...(r.rows[0]?.content||{})};}
  const db=readDb(); return {...DEFAULT_RATE_SETTINGS,...(db.rateSettings||{})};
}
async function saveRateSettings(x){
  const value={...DEFAULT_RATE_SETTINGS,...x};
  if(pool){await pool.query('INSERT INTO site_content (id,content,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()',['rate-settings',JSON.stringify(value)]);return value;}
  const db=readDb();db.rateSettings=value;writeDb(db);return value;
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
function readDb(){ return JSON.parse(fs.readFileSync(DATA,'utf8')); }
function writeDb(db){ fs.writeFileSync(DATA, JSON.stringify(db,null,2)); }
function safeContentLink(value){const raw=String(value||'events.html').trim().slice(0,500);if(!raw||raw.startsWith('//')||raw.includes('\\'))return 'events.html';if(/^[a-z][a-z0-9+.-]*:/i.test(raw)&&!/^https:\/\//i.test(raw))return 'events.html';try{const url=new URL(raw,'https://safepays.invalid/');return url.origin==='https://safepays.invalid'||url.protocol==='https:'?raw:'events.html';}catch(_){return 'events.html';}}
function cleanPublishedContent(items){return (Array.isArray(items)?items:[]).filter(x=>x&&['news','event'].includes(x.kind)).slice(0,100).map(x=>({id:String(x.id||`content-${crypto.randomUUID()}`).slice(0,80),kind:x.kind,title:String(x.title||'').trim().slice(0,140),excerpt:String(x.excerpt||'').trim().slice(0,700),image:/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(x.image||''))&&String(x.image).length<=1500000?String(x.image):'',cta:String(x.cta||'').trim().slice(0,80),link:safeContentLink(x.link),published:x.published!==false,reward:String(x.reward||'').trim().slice(0,100),deadline:String(x.deadline||'').trim().slice(0,100),createdAt:x.createdAt||new Date().toISOString()})).filter(x=>x.title.length>=3&&x.excerpt.length>=3);}
async function getPublishedContent(){if(pool){const r=await pool.query('SELECT content FROM site_content WHERE id=$1',['published-content']);return cleanPublishedContent(r.rows[0]?.content||[]);}const db=readDb();return cleanPublishedContent(db.publishedContent||[]);}
async function savePublishedContent(items){const clean=cleanPublishedContent(items);if(pool)await pool.query('INSERT INTO site_content (id,content,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()',['published-content',JSON.stringify(clean)]);else{const db=readDb();db.publishedContent=clean;writeDb(db);}return clean;}

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
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS address TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS wallet_id TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS request_key TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS locked_by TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS decision_by TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_request_key ON transactions(request_key) WHERE request_key IS NOT NULL');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_tx_hash_unique ON transactions(LOWER(tx_hash)) WHERE tx_hash IS NOT NULL AND tx_hash <> \'\'');
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
  await pool.query(`CREATE TABLE IF NOT EXISTS wallet_addresses (
    id TEXT PRIMARY KEY, network TEXT NOT NULL CHECK (network IN ('TRC20','ERC20')), address TEXT NOT NULL,
    label TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, team_id TEXT,
    created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (network,address)
  )`);
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ');
  await pool.query(`CREATE TABLE IF NOT EXISTS deposit_intents (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), wallet_id TEXT NOT NULL REFERENCES wallet_addresses(id),
    amount NUMERIC(20,8) NOT NULL, network TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS support_messages (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')), sender_id TEXT NOT NULL,
    message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_support_ticket_user_updated ON support_tickets(user_id,updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created ON support_messages(ticket_id,created_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL, meta JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)');
}
async function getUsers(){
  if(!pool) return readDb().users;
  const r=await pool.query('SELECT id, first_name AS "firstName", last_name AS "lastName", email, username, phone, password_hash AS "passwordHash", role, balance, referral_earnings AS "referralEarnings", referral_code AS "referralCode", referred_by AS "referredBy", two_factor_enabled AS "twoFactorEnabled", phone_verified AS "phoneVerified", email_verified AS "emailVerified", totp_secret AS "totpSecret", kyc_status AS "kycStatus", kyc_name AS "kycName", kyc_submitted_at AS "kycSubmittedAt", created_at AS "createdAt", security_status AS "securityStatus", withdrawal_frozen AS "withdrawalFrozen", deposit_frozen AS "depositFrozen", security_reason AS "securityReason", security_updated_at AS "securityUpdatedAt" FROM users');
  return r.rows;
}
async function getTransactions(){
  if(!pool) return readDb().transactions;
  const r=await pool.query('SELECT id, user_id AS "userId", type, amount, requested_amount AS "requestedAmount", received_amount AS "receivedAmount", currency, network, status, created_at AS "createdAt", tx_hash AS "txHash", address, wallet_id AS "walletId", request_key AS "requestKey", locked_by AS "lockedBy", locked_at AS "lockedAt", decision_by AS "decisionBy", decision_at AS "decisionAt", expires_at AS "expiresAt" FROM transactions ORDER BY created_at DESC');
  return r.rows;
}
async function getLedger(userId){
  if(!pool){const rows=readDb().ledger||[]; return rows.filter(x=>!userId||x.userId===userId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));}
  const q=userId ? await pool.query('SELECT id, user_id AS "userId", transaction_id AS "transactionId", direction, amount, currency, balance_before AS "balanceBefore", balance_after AS "balanceAfter", reason, metadata, created_at AS "createdAt" FROM ledger_entries WHERE user_id=$1 ORDER BY created_at DESC',[userId]) : await pool.query('SELECT id, user_id AS "userId", transaction_id AS "transactionId", direction, amount, currency, balance_before AS "balanceBefore", balance_after AS "balanceAfter", reason, metadata, created_at AS "createdAt" FROM ledger_entries ORDER BY created_at DESC');
  return q.rows;
}
async function addLedgerEntry({userId,transactionId=null,direction,amount,currency='USDT',reason,metadata={}} , client=null){
  const amt=Number(amount); if(!Number.isFinite(amt)||amt<=0) throw new Error('invalid_ledger_amount');
  let before;
  if(pool){const q=client||pool;const result=await q.query(`SELECT balance FROM users WHERE id=$1${client?' FOR UPDATE':''}`,[userId]);if(!result.rows[0])throw new Error('user_not_found');before=Number(result.rows[0].balance||0);}
  else{const user=await findUserById(userId);if(!user)throw new Error('user_not_found');before=Number(user.balance||0);}
  const after=Number((direction==='credit'?before+amt:before-amt).toFixed(8));
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
function body(req){ return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>2e6) req.destroy();});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)}); }
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
function readSession(req,cookieName,store){
  const t=parseCookies(req)[cookieName]||'';
  const s=store.get(t);
  if(!s || s.expires<Date.now()){if(t)store.delete(t);return null;}
  return s;
}
function adminAuth(req){return readSession(req,ADMIN_COOKIE,adminSessions);}
function ownerAuth(req){return readSession(req,OWNER_COOKIE,ownerSessions);}
function clearCookie(name){return name+'=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'+(process.env.NODE_ENV==='production'?'; Secure':'');}
function sessionCookie(name,value){return name+'='+encodeURIComponent(value)+'; Max-Age='+Math.floor(TTL/1000)+'; Path=/; HttpOnly; SameSite=Lax'+(process.env.NODE_ENV==='production'?'; Secure':'');}
function addAudit(action,actor,meta={}){
  const item={id:`AUD-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,action,actor,meta,createdAt:new Date().toISOString()};auditLog.unshift(item);if(auditLog.length>500)auditLog.pop();
  if(pool)pool.query('INSERT INTO audit_logs (id,action,actor,meta,created_at) VALUES ($1,$2,$3,$4,$5)',[item.id,item.action,item.actor,JSON.stringify(item.meta),item.createdAt]).catch(e=>console.error('Audit persistence failed',e));
  else{try{const db=readDb();db.auditLog=db.auditLog||[];db.auditLog.unshift(item);db.auditLog=db.auditLog.slice(0,500);writeDb(db);}catch(e){console.error('Audit persistence failed',e);}}
}
async function getAuditLog(){
  if(!pool)return readDb().auditLog||auditLog;
  const r=await pool.query('SELECT id,action,actor,meta,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 500');return r.rows;
}
function requestAuditMeta(req){
  const ua=String(req.headers['user-agent']||'');
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  const ip=String(req.headers['x-nf-client-connection-ip']||forwarded||req.socket.remoteAddress||'unknown');
  const device=/iPhone/i.test(ua)?'iPhone':/iPad/i.test(ua)?'iPad':/Android/i.test(ua)?'Android cihaz':/Windows/i.test(ua)?'Windows cihaz':/Mac OS X/i.test(ua)?'Mac':'Bilinmeyen cihaz';
  const browser=/CriOS|Chrome/i.test(ua)?'Chrome':/FxiOS|Firefox/i.test(ua)?'Firefox':/Edg/i.test(ua)?'Edge':/Safari/i.test(ua)?'Safari':'Bilinmiyor';
  return {ip,device,browser,userAgent:ua};
}
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
function redirect(res,location){res.writeHead(302,{'Location':location,'Cache-Control':'no-store'});res.end();}

async function insertTransaction(tx, client=null){
  if(!pool){const db=readDb();db.transactions.unshift(tx);writeDb(db);return;}
  await (client||pool).query('INSERT INTO transactions (id,user_id,type,amount,requested_amount,received_amount,currency,network,status,created_at,tx_hash,address,wallet_id,request_key,locked_by,locked_at,decision_by,decision_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)',[tx.id,tx.userId,tx.type,tx.amount,tx.requestedAmount??tx.amount,tx.receivedAmount??null,tx.currency,tx.network,tx.status,tx.createdAt,tx.txHash||null,tx.address||null,tx.walletId||null,tx.requestKey||null,tx.lockedBy||null,tx.lockedAt||null,tx.decisionBy||null,tx.decisionAt||null,tx.expiresAt||null]);
}
async function getWalletAddresses({activeOnly=false}={}){
  if(!pool){const rows=readDb().walletAddresses||[];return rows.filter(x=>!activeOnly||x.active);}
  const r=await pool.query(`SELECT id,network,address,label,active,team_id AS "teamId",created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt",use_count AS "useCount",last_used_at AS "lastUsedAt" FROM wallet_addresses ${activeOnly?'WHERE active=TRUE':''} ORDER BY created_at DESC`);
  return r.rows;
}
async function saveWalletAddress(wallet){
  if(!pool){const db=readDb();db.walletAddresses=db.walletAddresses||[];const i=db.walletAddresses.findIndex(x=>x.id===wallet.id);if(i>=0)db.walletAddresses[i]={...db.walletAddresses[i],...wallet};else db.walletAddresses.unshift(wallet);writeDb(db);return wallet;}
  await pool.query('INSERT INTO wallet_addresses (id,network,address,label,active,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET network=EXCLUDED.network,address=EXCLUDED.address,label=EXCLUDED.label,active=EXCLUDED.active,updated_at=EXCLUDED.updated_at',[wallet.id,wallet.network,wallet.address,wallet.label,wallet.active,wallet.createdBy,wallet.createdAt,wallet.updatedAt]);
  return wallet;
}
async function getDepositIntent(id,userId){
  if(!pool)return (readDb().depositIntents||[]).find(x=>x.id===id&&x.userId===userId)||null;
  const r=await pool.query('SELECT id,user_id AS "userId",wallet_id AS "walletId",amount,network,created_at AS "createdAt",expires_at AS "expiresAt",used_at AS "usedAt" FROM deposit_intents WHERE id=$1 AND user_id=$2',[id,userId]);return r.rows[0]||null;
}
function isValidNetwork(n){return n==='TRC20'||n==='ERC20';}
function isValidAddress(n,a){
  const v=String(a||'').trim();
  if(n==='TRC20') return /^T[1-9A-HJ-NP-Za-km-z]{20,40}$/.test(v);
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}
function makeUserId(existing=[]){ let id=''; do{id=String(crypto.randomInt(10000000,100000000));}while(existing.some(u=>String(u.id)===id)); return id; }
function makeTxId(){ const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; return Array.from({length:10},()=>chars[crypto.randomInt(0,chars.length)]).join(''); }
function currentBalance(u){return Number(u.balance||0);}
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
  if(req.url==='/api/system/maintenance' && req.method==='GET') return json(res,200,{maintenance:await getMaintenance()});
  if(req.url==='/api/content' && req.method==='GET')return json(res,200,{items:(await getPublishedContent()).filter(x=>x.published)});

  if(req.url==='/api/owner/login' && req.method==='POST'){
    const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),code=String(b.code||'').trim();
    if(!ADMIN_EMAIL||!ADMIN_PASSWORD||!ADMIN_TOTP_SECRET)return json(res,503,{error:'owner_login_not_configured'});
    if(email!==ADMIN_EMAIL.toLowerCase()||password!==ADMIN_PASSWORD){addAudit('owner_login_failed',email||'unknown',{...requestAuditMeta(req),reason:'invalid_credentials'});return json(res,401,{error:'invalid_owner_credentials'});}
    if(!/^\d{6}$/.test(code)||!verifyTotp(ADMIN_TOTP_SECRET,code)){addAudit('owner_login_failed',email,{...requestAuditMeta(req),reason:'invalid_2fa'});return json(res,401,{error:'invalid_2fa_code'});}
    const cookies=parseCookies(req);if(cookies[ADMIN_COOKIE])adminSessions.delete(cookies[ADMIN_COOKIE]);
    const t=token();ownerSessions.set(t,{ownerId:'OWNER-001',email:ADMIN_EMAIL,role:'owner',expires:Date.now()+TTL});
    addAudit('owner_login',ADMIN_EMAIL,requestAuditMeta(req));
    return json(res,200,{ok:true,owner:{id:'OWNER-001',email:ADMIN_EMAIL,role:'owner'},expiresIn:TTL/1000},{'Set-Cookie':[sessionCookie(OWNER_COOKIE,t),clearCookie(ADMIN_COOKIE)]});
  }
  if(req.url==='/api/admin/login' && req.method==='POST'){
    const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),code=String(b.code||'').trim();
    if(!TEAM_ADMIN_EMAIL||!TEAM_ADMIN_PASSWORD||!TEAM_ADMIN_TOTP_SECRET)return json(res,503,{error:'team_login_not_configured'});
    const credentialsOverlap=TEAM_ADMIN_EMAIL.toLowerCase()===ADMIN_EMAIL.toLowerCase()||TEAM_ADMIN_PASSWORD===ADMIN_PASSWORD||TEAM_ADMIN_TOTP_SECRET===ADMIN_TOTP_SECRET;
    if(credentialsOverlap)return json(res,503,{error:'team_credentials_not_separate'});
    if(email!==TEAM_ADMIN_EMAIL.toLowerCase()||password!==TEAM_ADMIN_PASSWORD){addAudit('team_login_failed',email||'unknown',{...requestAuditMeta(req),reason:'invalid_credentials'});return json(res,401,{error:'invalid_team_credentials'});}
    if(!/^\d{6}$/.test(code)||!verifyTotp(TEAM_ADMIN_TOTP_SECRET,code)){addAudit('team_login_failed',email,{...requestAuditMeta(req),reason:'invalid_2fa'});return json(res,401,{error:'invalid_2fa_code'});}
    const cookies=parseCookies(req);if(cookies[OWNER_COOKIE])ownerSessions.delete(cookies[OWNER_COOKIE]);
    const t=token();adminSessions.set(t,{adminId:'TEAM-ADMIN-001',email:TEAM_ADMIN_EMAIL,role:'team_admin',expires:Date.now()+TTL});
    addAudit('team_admin_login',TEAM_ADMIN_EMAIL,requestAuditMeta(req));
    return json(res,200,{ok:true,admin:{id:'TEAM-ADMIN-001',email:TEAM_ADMIN_EMAIL,role:'team_admin'},expiresIn:TTL/1000},{'Set-Cookie':[sessionCookie(ADMIN_COOKIE,t),clearCookie(OWNER_COOKIE)]});
  }
  if(req.url==='/api/admin/logout' && req.method==='POST'){
    const c=parseCookies(req)[ADMIN_COOKIE]||'';if(c)adminSessions.delete(c);return json(res,200,{ok:true},{'Set-Cookie':clearCookie(ADMIN_COOKIE)});
  }
  if(req.url==='/api/owner/logout' && req.method==='POST'){
    const c=parseCookies(req)[OWNER_COOKIE]||'';if(c)ownerSessions.delete(c);return json(res,200,{ok:true},{'Set-Cookie':clearCookie(OWNER_COOKIE)});
  }
  const owner=ownerAuth(req),teamAdmin=adminAuth(req),admin=owner||teamAdmin;
  if(req.url==='/api/owner/me' && req.method==='GET'){
    if(!owner)return json(res,401,{error:'unauthorized'});return json(res,200,{owner:{id:owner.ownerId,email:owner.email,role:owner.role}});
  }
  if(req.url==='/api/owner/team-accounts' && req.method==='GET'){
    if(!owner)return json(res,401,{error:'unauthorized'});
    const configured=!!(TEAM_ADMIN_EMAIL&&TEAM_ADMIN_PASSWORD&&TEAM_ADMIN_TOTP_SECRET);
    const credentialsOverlap=!!(TEAM_ADMIN_EMAIL.toLowerCase()===ADMIN_EMAIL.toLowerCase()||TEAM_ADMIN_PASSWORD===ADMIN_PASSWORD||TEAM_ADMIN_TOTP_SECRET===ADMIN_TOTP_SECRET);
    const status=!configured?'not_configured':credentialsOverlap?'credentials_conflict':'active';
    const accounts=TEAM_ADMIN_EMAIL?[{id:'TEAM-ADMIN-001',email:TEAM_ADMIN_EMAIL,role:'team_admin',status,twoFactorEnabled:!!TEAM_ADMIN_TOTP_SECRET,source:'render_environment'}]:[];
    return json(res,200,{accounts,configured:status==='active'});
  }
  if(req.url==='/api/admin/me' && req.method==='GET'){
    if(!teamAdmin)return json(res,401,{error:'unauthorized'});return json(res,200,{admin:{id:teamAdmin.adminId,email:teamAdmin.email,role:teamAdmin.role}});
  }
  const adminPath=new URL(req.url,'http://localhost').pathname;
  const ownerOnlyAdminRequest=adminPath==='/api/admin/content'||adminPath==='/api/admin/maintenance'||(adminPath.startsWith('/api/admin/user/')&&adminPath.endsWith('/security'))||(adminPath==='/api/admin/wallet-addresses'&&req.method==='POST')||(adminPath==='/api/admin/rates'&&req.method==='POST');
  if(teamAdmin&&!owner&&ownerOnlyAdminRequest)return json(res,403,{error:'owner_only'});
  if(req.url==='/api/admin/verify-2fa' && req.method==='POST'){if(!admin)return json(res,401,{error:'unauthorized'});const b=await body(req),code=String(b.code||'').trim(),secret=owner?ADMIN_TOTP_SECRET:TEAM_ADMIN_TOTP_SECRET,valid=!!secret&&verifyTotp(secret,code);if(!/^\d{6}$/.test(code)||!valid)return json(res,401,{error:'invalid_2fa_code'});addAudit('admin_sensitive_change_verified',admin.email,{role:admin.role});return json(res,200,{ok:true})}
  if(req.url==='/api/admin/content' && req.method==='GET'){if(!admin)return json(res,401,{error:'unauthorized'});return json(res,200,{items:await getPublishedContent()});}
  if(req.url==='/api/admin/content' && req.method==='POST'){if(!admin)return json(res,401,{error:'unauthorized'});const clean=await savePublishedContent((await body(req)).items);addAudit('published_content_updated',admin.email,{items:clean.length});return json(res,200,{ok:true,items:clean});}

  if(req.url==='/api/admin/maintenance' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    return json(res,200,{maintenance:await getMaintenance()});
  }
  if(req.url==='/api/admin/maintenance' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const b=await body(req);
    const clean=(x,fallback)=>({enabled:!!x?.enabled,until:x?.until?new Date(x.until).toISOString():null,message:String(x?.message||fallback).trim().slice(0,240)});
    const next={site:clean(b.site,DEFAULT_MAINTENANCE.site.message),panel:clean(b.panel,DEFAULT_MAINTENANCE.panel.message)};
    await saveMaintenance(next); addAudit('maintenance_update',admin.email,{maintenance:next});
    return json(res,200,{ok:true,maintenance:next});
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
  if(req.url.startsWith('/api/admin/user/') && !req.url.endsWith('/security') && req.method==='GET'){
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
  if(req.url==='/api/admin/transactions/verify-chain' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const b=await body(req),id=String(b.transactionId||''),transactions=await getTransactions(),tx=transactions.find(x=>x.id===id);
    if(!tx)return json(res,404,{error:'transaction_not_found'});
    if(!['deposit','withdrawal'].includes(tx.type))return json(res,400,{error:'unsupported_transaction_type'});
    const txHash=tx.type==='deposit'?String(tx.txHash||''):String(b.txHash||'').trim();
    const amount=Number(b.amount??tx.amount);
    if(!txHash)return json(res,400,{error:'tx_hash_required'});
    if(!Number.isFinite(amount)||amount<=0)return json(res,400,{error:'invalid_amount'});
    const verification=await verifyUsdtTransfer({network:tx.network,txHash,recipient:tx.address,amount});
    addAudit('chain_transfer_check',admin.email,{transactionId:id,network:tx.network,type:tx.type,txHash,status:verification.status,reason:verification.reason,blockNumber:verification.blockNumber||null});
    return json(res,200,{ok:true,verification});
  }
  if(req.url==='/api/admin/ledger' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const urlObj=new URL(req.url,'http://localhost'); const userId=urlObj.searchParams.get('userId')||null; return json(res,200,{ledger:await getLedger(userId)});
  }
  if(req.url==='/api/admin/wallet-addresses' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});return json(res,200,{wallets:await getWalletAddresses()});
  }
  if(req.url==='/api/admin/wallet-addresses' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const b=await body(req),action=String(b.action||'add');
    if(action==='add'){
      const network=String(b.network||'').toUpperCase(),address=String(b.address||'').trim(),label=String(b.label||'').trim().slice(0,80);
      if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
      if(!isValidAddress(network,address))return json(res,400,{error:'invalid_address'});
      if(!label)return json(res,400,{error:'invalid_label'});
      if((await getWalletAddresses()).some(w=>w.network===network&&String(w.address).toLowerCase()===address.toLowerCase()))return json(res,409,{error:'wallet_exists'});
      const now=new Date().toISOString(),wallet={id:`WLT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,network,address,label,active:b.active!==false,createdBy:admin.email,createdAt:now,updatedAt:now,useCount:0,lastUsedAt:null};
      await saveWalletAddress(wallet);addAudit('wallet_address_created',admin.email,{walletId:wallet.id,network});return json(res,201,{ok:true,wallet});
    }
    const id=String(b.id||''),wallets=await getWalletAddresses(),current=wallets.find(w=>w.id===id);if(!current)return json(res,404,{error:'wallet_not_found'});
    if(action==='delete'){
      if((await getTransactions()).some(x=>x.walletId===id)){
        if(pool)await pool.query('UPDATE wallet_addresses SET active=FALSE,updated_at=NOW() WHERE id=$1',[id]);else{const db=readDb();const w=(db.walletAddresses||[]).find(x=>x.id===id);w.active=false;w.updatedAt=new Date().toISOString();writeDb(db);}
        addAudit('wallet_address_deactivated',admin.email,{walletId:id});return json(res,200,{ok:true,deleted:false,active:false});
      }
      if(pool)await pool.query('DELETE FROM wallet_addresses WHERE id=$1',[id]);else{const db=readDb();db.walletAddresses=(db.walletAddresses||[]).filter(x=>x.id!==id);writeDb(db);}
      addAudit('wallet_address_deleted',admin.email,{walletId:id});return json(res,200,{ok:true,deleted:true});
    }
    if(action==='update'){
      const network=String(b.network||current.network).toUpperCase(),address=String(b.address||current.address).trim(),label=String(b.label||current.label).trim().slice(0,80);
      if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});if(!isValidAddress(network,address))return json(res,400,{error:'invalid_address'});if(!label)return json(res,400,{error:'invalid_label'});
      if(wallets.some(w=>w.id!==id&&w.network===network&&String(w.address).toLowerCase()===address.toLowerCase()))return json(res,409,{error:'wallet_exists'});
      const next={...current,network,address,label,active:b.active===undefined?current.active:!!b.active,updatedAt:new Date().toISOString()};await saveWalletAddress(next);addAudit('wallet_address_updated',admin.email,{walletId:id,network,active:next.active});return json(res,200,{ok:true,wallet:next});
    }
    return json(res,400,{error:'invalid_action'});
  }
  if(new URL(req.url,'http://localhost').pathname==='/api/admin/support/tickets' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    if(pool){const r=await pool.query('SELECT t.id,t.user_id AS "userId",t.subject,t.status,t.created_at AS "createdAt",t.updated_at AS "updatedAt",u.email,u.first_name AS "firstName",u.last_name AS "lastName" FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC');const ids=r.rows.map(x=>x.id);const m=ids.length?await pool.query('SELECT id,ticket_id AS "ticketId",sender_role AS "senderRole",sender_id AS "senderId",message,created_at AS "createdAt" FROM support_messages WHERE ticket_id=ANY($1::text[]) ORDER BY created_at',[ids]):{rows:[]};const byId=new Map();for(const msg of m.rows){if(!byId.has(msg.ticketId))byId.set(msg.ticketId,[]);byId.get(msg.ticketId).push(msg);}return json(res,200,{tickets:r.rows.map(x=>({...x,messages:byId.get(x.id)||[]}))});}
    const db=readDb(),users=db.users||[],messages=db.supportMessages||[];return json(res,200,{tickets:(db.supportTickets||[]).map(t=>({...t,user:users.find(u=>u.id===t.userId)?safeUser(users.find(u=>u.id===t.userId)):null,messages:messages.filter(m=>m.ticketId===t.id)})).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))});
  }
  const adminSupportMatch=new URL(req.url,'http://localhost').pathname.match(/^\/api\/admin\/support\/tickets\/([^/]+)\/messages$/);
  if(adminSupportMatch&&req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});const ticketId=decodeURIComponent(adminSupportMatch[1]),b=await body(req),message=String(b.message||'').trim().slice(0,4000);if(!message)return json(res,400,{error:'empty_message'});
    if(pool){const client=await pool.connect();try{await client.query('BEGIN');const ticket=await client.query("SELECT id FROM support_tickets WHERE id=$1 AND status<>'closed' FOR UPDATE",[ticketId]);if(!ticket.rows[0]){await client.query('ROLLBACK');return json(res,404,{error:'ticket_not_found'});}const item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId,senderRole:'admin',senderId:admin.email,message,createdAt:new Date().toISOString()};await client.query('INSERT INTO support_messages (id,ticket_id,sender_role,sender_id,message,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[item.id,ticketId,item.senderRole,item.senderId,item.message,item.createdAt]);await client.query("UPDATE support_tickets SET status='open',updated_at=$1 WHERE id=$2",[item.createdAt,ticketId]);await client.query('COMMIT');addAudit('support_reply',admin.email,{ticketId});return json(res,201,{ok:true,message:item});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
    const db=readDb(),ticket=(db.supportTickets||[]).find(x=>x.id===ticketId&&x.status!=='closed');if(!ticket)return json(res,404,{error:'ticket_not_found'});const item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId,senderRole:'admin',senderId:admin.email,message,createdAt:new Date().toISOString()};db.supportMessages=db.supportMessages||[];db.supportMessages.push(item);ticket.status='open';ticket.updatedAt=item.createdAt;writeDb(db);addAudit('support_reply',admin.email,{ticketId});return json(res,201,{ok:true,message:item});
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
    const payoutTxHash=tx.type==='withdrawal'&&decision==='approved'?String(b.payoutTxHash||'').trim():null;
    if(payoutTxHash!==null&&payoutTxHash.length<16)return json(res,400,{error:'payout_tx_hash_required',message:'Çekimi onaylamadan önce gönderdiğiniz transferin işlem kimliğini girin.'});
    if(decision==='approved' && tx.type==='withdrawal'){const u=await findUserById(tx.userId);if(approvedAmount>Number(u.balance||0))return json(res,409,{error:'insufficient_balance_at_approval'});}
    const decisionAt=new Date().toISOString(); const amountChanged=Math.abs(approvedAmount-requestedAmount)>1e-8;
    if(pool){const client=await pool.connect(); try {await client.query('BEGIN'); const lock=await client.query("SELECT status, locked_by FROM transactions WHERE id=$1 FOR UPDATE",[id]); if(!lock.rows[0]||lock.rows[0].status!=='pending'){await client.query('ROLLBACK');return json(res,409,{error:'already_processed'});} if(lock.rows[0].locked_by&&lock.rows[0].locked_by!==admin.email){await client.query('ROLLBACK');return json(res,409,{error:'transaction_locked',lockedBy:lock.rows[0].locked_by});} if(decision==='approved'&&tx.type==='withdrawal'){const lockedUser=await client.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE',[tx.userId]);if(!lockedUser.rows[0]||approvedAmount>Number(lockedUser.rows[0].balance||0)){await client.query('ROLLBACK');return json(res,409,{error:'insufficient_balance_at_approval'});}} await client.query('UPDATE transactions SET status=$1,amount=$2,requested_amount=COALESCE(requested_amount,$3),received_amount=$4,decision_by=$5,decision_at=$6,locked_by=NULL,locked_at=NULL,tx_hash=COALESCE($7,tx_hash) WHERE id=$8',[decision,approvedAmount,requestedAmount,approvedAmount,admin.email,decisionAt,payoutTxHash,id]); if(decision==='approved') await addLedgerEntry({userId:tx.userId,transactionId:tx.id,direction:tx.type==='deposit'?'credit':'debit',amount:approvedAmount,reason:tx.type==='deposit'?'deposit_approved':'withdrawal_approved',metadata:{network:tx.network,admin:admin.email,requestedAmount,approvedAmount,amountChanged,payoutTxHash}},client); await client.query('COMMIT');} catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}}
    else{const db=readDb();const row=db.transactions.find(x=>x.id===id);if(!row||row.status!=='pending')return json(res,409,{error:'already_processed'});if(row.lockedBy&&row.lockedBy!==admin.email&&isLocked(row))return json(res,409,{error:'transaction_locked',lockedBy:row.lockedBy});row.requestedAmount=Number(row.requestedAmount??row.amount);row.receivedAmount=approvedAmount;row.amount=approvedAmount;row.status=decision;row.decisionBy=admin.email;row.decisionAt=decisionAt;row.lockedBy=null;row.lockedAt=null;if(payoutTxHash)row.txHash=payoutTxHash;if(decision==='approved'){const u=db.users.find(x=>x.id===tx.userId);const before=Number(u.balance||0);const credit=tx.type==='deposit';const after=Number((credit?before+approvedAmount:before-approvedAmount).toFixed(8));if(after<0)return json(res,409,{error:'negative_balance_at_approval'});u.balance=after;db.ledger=db.ledger||[];db.ledger.unshift({id:`LED-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,userId:tx.userId,transactionId:tx.id,direction:credit?'credit':'debit',amount:approvedAmount,currency:tx.currency||'USDT',balanceBefore:before,balanceAfter:after,reason:credit?'deposit_approved':'withdrawal_approved',metadata:{network:tx.network,admin:admin.email,requestedAmount,approvedAmount,amountChanged,payoutTxHash},createdAt:decisionAt});}writeDb(db);}
    addAudit('transaction_decision',admin.email,{transactionId:id,userId:tx.userId,type:tx.type,decision,requestedAmount,approvedAmount,amountChanged,payoutTxHash}); return json(res,200,{ok:true,status:decision,decisionBy:admin.email,decisionAt,requestedAmount,approvedAmount,amountChanged,payoutTxHash});
  }
  if(req.url==='/api/admin/audit' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); return json(res,200,{audit:await getAuditLog()});
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
    if(!validPhone(phone)) return json(res,400,{error:'invalid_phone',message:'Telefon +90XXXXXXXXXX formatında olmalı.'});
    if(password.length<8) return json(res,400,{error:'weak_password'});
    const users=await getUsers();
    if(users.some(u=>u.email.toLowerCase()===email)) return json(res,409,{error:'email_exists'});
    if(users.some(u=>normalizePhone(u.phone)===phone)) return json(res,409,{error:'phone_exists'});
    if(users.some(u=>String(u.username||'').toLowerCase()===username)) return json(res,409,{error:'username_exists',message:'Bu kullanıcı adı zaten kullanılıyor.'});
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
    const valid=u && verifyPassword(password,u.passwordHash);
    if(!valid) return json(res,401,{error:'invalid_credentials'});
    if(u.securityStatus==='locked') return json(res,403,{error:'account_locked',message:'Hesabınız güvenlik nedeniyle kilitlenmiştir.'});
    const t=token(); sessions.set(t,{userId:u.id,expires:Date.now()+TTL});
    return json(res,200,{token:t,user:safeUser(u),expiresIn:TTL/1000});
  }

  if(req.url==='/api/auth/send-verification' && req.method==='POST'){
    return json(res,503,{ok:false,error:'verification_provider_not_configured',message:'E-posta veya SMS doğrulama sağlayıcısı henüz yapılandırılmadı.'});
  }
  if(req.url==='/api/auth/verify' && req.method==='POST'){
    const b=await body(req); const type=b.type==='phone'?'phone':'email'; const value=String(b.value||'').trim().toLowerCase(); const code=String(b.code||''); const key=`${type}:${value}`; const item=verificationCodes.get(key);
    if(!item || item.expires<Date.now() || item.code!==code) return json(res,400,{error:'invalid_code'});
    verificationCodes.delete(key); return json(res,200,{ok:true,verified:true,type});
  }

  if(req.url==='/api/auth/forgot-password' && req.method==='POST'){
    return json(res,503,{ok:false,error:'email_provider_not_configured',message:'Şifre sıfırlama e-postası şu anda gönderilemiyor; e-posta sağlayıcısı yapılandırılmalı.'});
  }

  // Self-contained password-reset flow (works on any Node host, incl. Render — no Netlify/email dependency required).
  // action=send -> generates a 6-digit code (10 min TTL). action=verify -> checks the code and, if newPassword is
  // provided, updates the real user's password hash server-side (the client must never mutate passwords itself).
  if(req.url==='/api/password-reset' && req.method==='POST'){
    const b=await body(req); const action=String(b.action||''); const email=String(b.email||'').trim().toLowerCase();
    if(!validEmail(email)) return json(res,400,{error:'invalid_email'});
    if(action==='send'){
      return json(res,503,{ok:false,error:'email_provider_not_configured',message:'Şifre sıfırlama e-postası şu anda gönderilemiyor; e-posta sağlayıcısı yapılandırılmalı.'});
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
  if(req.url==='/api/support/tickets' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    if(pool){const r=await pool.query('SELECT id,user_id AS "userId",subject,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC',[uid]);const ids=r.rows.map(x=>x.id);const m=ids.length?await pool.query('SELECT id,ticket_id AS "ticketId",sender_role AS "senderRole",sender_id AS "senderId",message,created_at AS "createdAt" FROM support_messages WHERE ticket_id=ANY($1::text[]) ORDER BY created_at',[ids]):{rows:[]};const byId=new Map();for(const msg of m.rows){if(!byId.has(msg.ticketId))byId.set(msg.ticketId,[]);byId.get(msg.ticketId).push(msg);}return json(res,200,{tickets:r.rows.map(x=>({...x,messages:byId.get(x.id)||[]}))});}
    const db=readDb();return json(res,200,{tickets:(db.supportTickets||[]).filter(x=>x.userId===uid).map(t=>({...t,messages:(db.supportMessages||[]).filter(m=>m.ticketId===t.id)})).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))});
  }
  if(req.url==='/api/support/tickets' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});const b=await body(req),subject=String(b.subject||'').trim().slice(0,160),message=String(b.message||'').trim().slice(0,4000);if(subject.length<3||!message)return json(res,400,{error:'invalid_ticket'});
    const now=new Date().toISOString(),ticket={id:`SUP-${crypto.randomBytes(7).toString('hex').toUpperCase()}`,userId:uid,subject,status:'open',createdAt:now,updatedAt:now},item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId:ticket.id,senderRole:'user',senderId:uid,message,createdAt:now};
    if(pool){const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO support_tickets (id,user_id,subject,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)',[ticket.id,uid,ticket.subject,ticket.status,now,now]);await client.query('INSERT INTO support_messages (id,ticket_id,sender_role,sender_id,message,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[item.id,ticket.id,item.senderRole,item.senderId,item.message,now]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
    else{const db=readDb();db.supportTickets=db.supportTickets||[];db.supportMessages=db.supportMessages||[];db.supportTickets.unshift(ticket);db.supportMessages.push(item);writeDb(db);}
    return json(res,201,{ok:true,ticket:{...ticket,messages:[item]}});
  }
  const memberSupportMatch=new URL(req.url,'http://localhost').pathname.match(/^\/api\/support\/tickets\/([^/]+)(?:\/(messages|close))?$/);
  if(memberSupportMatch){
    if(!uid)return json(res,401,{error:'unauthorized'});const ticketId=decodeURIComponent(memberSupportMatch[1]),sub=memberSupportMatch[2]||'';
    if(!sub&&req.method==='GET'){
      if(pool){const r=await pool.query('SELECT id,user_id AS "userId",subject,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM support_tickets WHERE id=$1 AND user_id=$2',[ticketId,uid]);if(!r.rows[0])return json(res,404,{error:'ticket_not_found'});const m=await pool.query('SELECT id,ticket_id AS "ticketId",sender_role AS "senderRole",sender_id AS "senderId",message,created_at AS "createdAt" FROM support_messages WHERE ticket_id=$1 ORDER BY created_at',[ticketId]);return json(res,200,{ticket:{...r.rows[0],messages:m.rows}});}
      const db=readDb(),ticket=(db.supportTickets||[]).find(x=>x.id===ticketId&&x.userId===uid);if(!ticket)return json(res,404,{error:'ticket_not_found'});return json(res,200,{ticket:{...ticket,messages:(db.supportMessages||[]).filter(m=>m.ticketId===ticketId)}});
    }
    if(sub==='messages'&&req.method==='POST'){
      const b=await body(req),message=String(b.message||'').trim().slice(0,4000);if(!message)return json(res,400,{error:'empty_message'});
      const item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId,senderRole:'user',senderId:uid,message,createdAt:new Date().toISOString()};
      if(pool){const client=await pool.connect();try{await client.query('BEGIN');const t=await client.query("SELECT id FROM support_tickets WHERE id=$1 AND user_id=$2 AND status<>'closed' FOR UPDATE",[ticketId,uid]);if(!t.rows[0]){await client.query('ROLLBACK');return json(res,404,{error:'ticket_not_found'});}await client.query('INSERT INTO support_messages (id,ticket_id,sender_role,sender_id,message,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[item.id,ticketId,item.senderRole,item.senderId,item.message,item.createdAt]);await client.query('UPDATE support_tickets SET updated_at=$1 WHERE id=$2',[item.createdAt,ticketId]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
      else{const db=readDb(),t=(db.supportTickets||[]).find(x=>x.id===ticketId&&x.userId===uid&&x.status!=='closed');if(!t)return json(res,404,{error:'ticket_not_found'});db.supportMessages=db.supportMessages||[];db.supportMessages.push(item);t.updatedAt=item.createdAt;writeDb(db);}
      return json(res,201,{ok:true,message:item});
    }
    if(sub==='close'&&req.method==='POST'){
      if(pool){const r=await pool.query("UPDATE support_tickets SET status='closed',updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING status",[ticketId,uid]);if(!r.rows[0])return json(res,404,{error:'ticket_not_found'});return json(res,200,{ok:true,status:'closed'});}
      const db=readDb(),t=(db.supportTickets||[]).find(x=>x.id===ticketId&&x.userId===uid);if(!t)return json(res,404,{error:'ticket_not_found'});t.status='closed';t.updatedAt=new Date().toISOString();writeDb(db);return json(res,200,{ok:true,status:'closed'});
    }
    return json(res,405,{error:'method_not_allowed'});
  }
  if(req.url==='/api/auth/me' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const u=await findUserById(uid); return json(res,200,{user:safeUser(u)});
  }
  if(req.url==='/api/auth/change-password' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    const b=await body(req),currentPassword=String(b.currentPassword||''),newPassword=String(b.newPassword||'');
    if(newPassword.length<8)return json(res,400,{error:'weak_password',message:'Yeni şifre en az 8 karakter olmalı.'});
    const user=await findUserById(uid);
    if(!user||!verifyPassword(currentPassword,user.passwordHash))return json(res,403,{error:'invalid_current_password',message:'Mevcut şifre hatalı.'});
    const passwordHash=hashPassword(newPassword);
    if(pool)await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[passwordHash,uid]);
    else{const db=readDb(),row=db.users.find(x=>x.id===uid);if(!row)return json(res,404,{error:'user_not_found'});row.passwordHash=passwordHash;writeDb(db);}
    addAudit('user_password_changed',uid,{});
    return json(res,200,{ok:true});
  }
  if(req.url==='/api/referrals' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    const user=await findUserById(uid),users=await getUsers(),tx=await getTransactions();
    const referrals=users.filter(x=>x.referredBy===uid).map(x=>{const own=tx.filter(t=>t.userId===x.id);return {id:x.id,name:[x.firstName,x.lastName].filter(Boolean).join(' '),createdAt:x.createdAt,hasApprovedDeposit:own.some(t=>t.type==='deposit'&&t.status==='approved')};});
    return json(res,200,{referralCode:user?.referralCode||null,total:referrals.length,active:referrals.filter(x=>x.hasApprovedDeposit).length,earnings:Number(user?.referralEarnings||0),referrals});
  }

  if(req.url==='/api/rates' && req.method==='GET'){
    const snap=await getMarketSnapshot(); const settings=await getRateSettings();
    const market=Number(snap.market); const safepays=calc(market,settings.usdTrySpread);
    if(settings.minRate && safepays<settings.minRate)return json(res,503,{error:'rate_below_configured_min'});
    if(settings.maxRate && safepays>settings.maxRate)return json(res,503,{error:'rate_above_configured_max'});
    return json(res,200,{ok:true,base:'USDT',currency:'TRY',marketRate:Number(market.toFixed(4)),safepaysRate:Number(safepays.toFixed(4)),spread:Number(settings.usdTrySpread),source:snap.source,stale:!!snap.stale,rateAgeSeconds:Math.round((snap.ageMs||0)/1000),warning:snap.warning||null,networks:{TRC20:{feeUsdt:Number(settings.trc20FeeUsdt)},ERC20:{feeUsdt:Number(settings.erc20FeeUsdt)}},updatedAt:new Date(snap.fetchedAt||Date.now()).toISOString()});
  }
  if(req.url==='/api/quote' && req.method==='POST'){
    const b=await body(req); const tryAmount=Number(b.tryAmount); const usdtAmount=Number(b.usdtAmount); const network=String(b.network||'TRC20').toUpperCase();
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    const snap=await getMarketSnapshot(); const settings=await getRateSettings(); const market=Number(snap.market); const safepays=calc(market,settings.usdTrySpread);
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
    const market=await getMarketUsdtTry(); const settings=await getRateSettings(); const safepays=calc(market,settings.usdTrySpread);
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    if(Number.isFinite(tryAmount)&&tryAmount>0) return json(res,200,{ok:true,direction:'TRY_TO_USDT',tryAmount,usdtAmount:Number((tryAmount/safepays).toFixed(6)),marketRate:Number(market.toFixed(4)),safepaysRate:Number(safepays.toFixed(4)),network,feeUsdt:Number(settings[network==='TRC20'?'trc20FeeUsdt':'erc20FeeUsdt'])});
    if(Number.isFinite(usdtAmount)&&usdtAmount>0) return json(res,200,{ok:true,direction:'USDT_TO_TRY',usdtAmount,tryAmount:Number((usdtAmount*safepays).toFixed(2)),marketRate:Number(market.toFixed(4)),safepaysRate:Number(safepays.toFixed(4)),network,feeUsdt:Number(settings[network==='TRC20'?'trc20FeeUsdt':'erc20FeeUsdt'])});
    return json(res,400,{error:'invalid_amount'});
  }
  if(req.url==='/api/admin/rates' && req.method==='GET'){
    const a=admin; if(!a)return json(res,401,{error:'unauthorized'}); const snap=await getMarketSnapshot(); const settings=await getRateSettings(); return json(res,200,{marketRate:snap.market,safepaysRate:calc(snap.market,settings.usdTrySpread),source:snap.source,stale:!!snap.stale,rateAgeSeconds:Math.round((snap.ageMs||0)/1000),...settings});
  }
  if(req.url==='/api/admin/rates' && req.method==='POST'){
    const a=admin; if(!a)return json(res,401,{error:'unauthorized'}); if(!owner)return json(res,403,{error:'owner_only'}); const b=await body(req); const usdTrySpread=Math.max(0,Number(b.usdTrySpread)); const trc20FeeUsdt=Math.max(0,Number(b.trc20FeeUsdt)); const erc20FeeUsdt=Math.max(0,Number(b.erc20FeeUsdt)); const quoteTtlSeconds=Math.min(300,Math.max(15,Number(b.quoteTtlSeconds||60))); const maxRateAgeSeconds=Math.min(3600,Math.max(30,Number(b.maxRateAgeSeconds||300))); const minRate=Math.max(0,Number(b.minRate||0)); const maxRate=Math.max(minRate,Number(b.maxRate||100000)); if(![usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate].every(Number.isFinite))return json(res,400,{error:'invalid_rate_settings'}); await saveRateSettings({usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate}); addAudit('rate_settings_update',a.email,{usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate}); const snap=await getMarketSnapshot(); return json(res,200,{ok:true,marketRate:snap.market,safepaysRate:calc(snap.market,usdTrySpread),source:snap.source,usdTrySpread,trc20FeeUsdt,erc20FeeUsdt,quoteTtlSeconds,maxRateAgeSeconds,minRate,maxRate});
  }

  if(req.url==='/api/deposits/prepare' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    const b=await body(req),amount=Number(b.amount),network=String(b.network||'').toUpperCase(),user=await findUserById(uid);
    if(user?.securityStatus==='locked'||user?.securityStatus==='suspended'||user?.depositFrozen)return json(res,403,{error:'deposits_blocked'});
    if(!Number.isFinite(amount)||amount<10)return json(res,400,{error:'invalid_amount'});if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    const available=(await getWalletAddresses({activeOnly:true})).filter(w=>w.network===network);if(!available.length)return json(res,409,{error:'wallet_unavailable',message:'Bu ağ için aktif yatırım adresi henüz yapılandırılmadı.'});
    const now=new Date(),expiresAt=new Date(now.getTime()+20*60*1000).toISOString();let wallet,intent;
    if(pool){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const picked=await client.query('SELECT id,network,address,label FROM wallet_addresses WHERE network=$1 AND active=TRUE ORDER BY last_used_at NULLS FIRST,use_count,created_at FOR UPDATE SKIP LOCKED LIMIT 1',[network]);
        if(!picked.rows[0]){await client.query('ROLLBACK');return json(res,409,{error:'wallet_unavailable'});}
        wallet=picked.rows[0];await client.query('UPDATE wallet_addresses SET use_count=use_count+1,last_used_at=$1,updated_at=$1 WHERE id=$2',[now.toISOString(),wallet.id]);
        intent={id:`DPI-${crypto.randomBytes(12).toString('hex').toUpperCase()}`,userId:uid,walletId:wallet.id,amount,network,createdAt:now.toISOString(),expiresAt};
        await client.query('INSERT INTO deposit_intents (id,user_id,wallet_id,amount,network,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[intent.id,uid,wallet.id,amount,network,intent.createdAt,intent.expiresAt]);await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }else{
      wallet=available.sort((a,b)=>Number(a.useCount||0)-Number(b.useCount||0)||new Date(a.lastUsedAt||0)-new Date(b.lastUsedAt||0))[0];
      const db=readDb(),saved=(db.walletAddresses||[]).find(w=>w.id===wallet.id);saved.useCount=Number(saved.useCount||0)+1;saved.lastUsedAt=now.toISOString();saved.updatedAt=now.toISOString();
      intent={id:`DPI-${crypto.randomBytes(12).toString('hex').toUpperCase()}`,userId:uid,walletId:wallet.id,amount,network,createdAt:now.toISOString(),expiresAt,usedAt:null};db.depositIntents=db.depositIntents||[];db.depositIntents.unshift(intent);writeDb(db);
    }
    return json(res,201,{ok:true,intentId:intent.id,amount,network,address:wallet.address,label:wallet.label,walletId:wallet.id,createdAt:intent.createdAt,expiresAt:intent.expiresAt});
  }
  if(req.url==='/api/deposits' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    const b=await body(req); const amount=Number(b.amount); const network=String(b.network||'').toUpperCase(); const txHash=String(b.txHash||'').trim(); const currentUser=await findUserById(uid); if(currentUser?.securityStatus==='locked'||currentUser?.securityStatus==='suspended'||currentUser?.depositFrozen) return json(res,403,{error:'deposits_blocked',message:'Yatırım talepleri güvenlik nedeniyle geçici olarak dondurulmuştur.'}); const requestKey=getRequestKey(req,b) || `AUTO-${crypto.randomUUID()}`;
    if(requestKey){const existingKey=(await getTransactions()).find(x=>x.requestKey===requestKey && x.userId===uid); if(existingKey)return json(res,200,{ok:true,idempotent:true,transaction:existingKey});}
    if(!Number.isFinite(amount)||amount<10)return json(res,400,{error:'invalid_amount',message:'Minimum yatırım 10 USDT.'});
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    if(txHash.length<16)return json(res,400,{error:'invalid_tx_hash'});
    const intent=await getDepositIntent(String(b.intentId||''),uid);
    if(!intent||intent.usedAt||new Date(intent.expiresAt).getTime()<=Date.now()||Number(intent.amount)!==amount||intent.network!==network)return json(res,400,{error:'invalid_deposit_intent'});
    const wallet=(await getWalletAddresses()).find(w=>w.id===intent.walletId);if(!wallet)return json(res,400,{error:'wallet_unavailable'});
    const existing=(await getTransactions()).find(x=>x.txHash&&x.txHash.toLowerCase()===txHash.toLowerCase());
    if(existing)return json(res,409,{error:'duplicate_tx_hash',transactionId:existing.id});
    const cooldown=await requestCooldownRemaining(uid);
    if(cooldown>0)return json(res,429,{error:'request_cooldown',cooldownSeconds:Math.ceil(cooldown/1000),message:'Yeni yatırım veya çekim talebi için '+Math.ceil(cooldown/1000)+' saniye beklemelisiniz.'});
    const createdAt=new Date(); const tx={id:makeTxId(),userId:uid,type:'deposit',amount,requestedAmount:amount,receivedAmount:null,currency:'USDT',network,status:'pending',createdAt:createdAt.toISOString(),txHash,address:wallet.address,walletId:wallet.id,requestKey,expiresAt:new Date(createdAt.getTime()+TX_CONTROL.autoRejectMinutes*60000).toISOString()};
    if(pool){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const claimed=await client.query('UPDATE deposit_intents SET used_at=NOW() WHERE id=$1 AND user_id=$2 AND used_at IS NULL AND expires_at>NOW() RETURNING id',[intent.id,uid]);
        if(!claimed.rows[0]){await client.query('ROLLBACK');return json(res,400,{error:'invalid_deposit_intent'});}
        await insertTransaction(tx,client);
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }else{
      const db=readDb(),row=(db.depositIntents||[]).find(x=>x.id===intent.id&&x.userId===uid);
      if(!row||row.usedAt||new Date(row.expiresAt).getTime()<=Date.now())return json(res,400,{error:'invalid_deposit_intent'});
      row.usedAt=new Date().toISOString();db.transactions.unshift(tx);writeDb(db);
    }
    startRequestCooldown(uid); addAudit('deposit_request',uid,{transactionId:tx.id,amount,network});
    return json(res,201,{ok:true,transaction:tx,requestKey,message:'Yatırım talebi alındı. Yeni talep oluşturabilirsiniz; her talep ayrı işlem ID ile kaydedilir.'});
  }
  if(req.url==='/api/withdrawals' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});
    const b=await body(req); const amount=Number(b.amount); const network=String(b.network||'').toUpperCase(); const address=String(b.address||'').trim(); const u=await findUserById(uid); if(u?.securityStatus==='locked'||u?.securityStatus==='suspended'||u?.withdrawalFrozen) return json(res,403,{error:'withdrawals_blocked',message:'Çekim talepleri güvenlik nedeniyle geçici olarak dondurulmuştur.'}); const requestKey=getRequestKey(req,b) || `AUTO-${crypto.randomUUID()}`;
    if(requestKey){const existingKey=(await getTransactions()).find(x=>x.requestKey===requestKey && x.userId===uid); if(existingKey)return json(res,200,{ok:true,idempotent:true,transaction:existingKey});}
    if(!Number.isFinite(amount)||amount<10)return json(res,400,{error:'invalid_amount',message:'Minimum çekim 10 USDT.'});
    if(!isValidNetwork(network))return json(res,400,{error:'invalid_network'});
    if(!isValidAddress(network,address))return json(res,400,{error:'invalid_address',message:'Cüzdan adresi seçilen ağ ile uyumlu değil.'});
    if(amount>currentBalance(u))return json(res,400,{error:'insufficient_balance'});
    const pending=(await getTransactions()).filter(x=>x.userId===uid&&x.type==='withdrawal'&&x.status==='pending').reduce((a,x)=>a+Number(x.amount||0),0);
    if(amount+pending>currentBalance(u))return json(res,400,{error:'insufficient_available_balance'});
    const cooldown=await requestCooldownRemaining(uid);
    if(cooldown>0)return json(res,429,{error:'request_cooldown',cooldownSeconds:Math.ceil(cooldown/1000),message:'Yeni yatırım veya çekim talebi için '+Math.ceil(cooldown/1000)+' saniye beklemelisiniz.'});
    startRequestCooldown(uid);
    const createdAt=new Date(); const tx={id:makeTxId(),userId:uid,type:'withdrawal',amount,requestedAmount:amount,receivedAmount:null,currency:'USDT',network,status:'pending',createdAt:createdAt.toISOString(),txHash:null,address,requestKey,expiresAt:new Date(createdAt.getTime()+TX_CONTROL.autoRejectMinutes*60000).toISOString()};
    await insertTransaction(tx); addAudit('withdrawal_request',uid,{transactionId:tx.id,amount,network});
    return json(res,201,{ok:true,transaction:tx,requestKey,message:'Çekim talebi alındı. Yeni talep oluşturabilirsiniz; her talep ayrı işlem ID ile kaydedilir.'});
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
  const staticPath=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&staticPath.endsWith('.html')){
    if(staticPath.startsWith('/owner/')){
      if(teamAdmin&&!owner)return redirect(res,'/admin/team-dashboard.html');
      if(owner&&staticPath==='/owner/login.html')return redirect(res,'/owner/dashboard.html');
      if(!owner&&staticPath!=='/owner/login.html')return redirect(res,'/owner/login.html');
    }
    if(staticPath.startsWith('/admin/')){
      if(owner)return redirect(res,'/owner/dashboard.html');
      if(teamAdmin&&staticPath==='/admin/dashboard.html')return redirect(res,'/admin/team-dashboard.html');
      if(teamAdmin&&staticPath==='/admin/login.html')return redirect(res,'/admin/team-dashboard.html');
      if(!teamAdmin&&staticPath!=='/admin/login.html')return redirect(res,'/admin/login.html');
    }
  }
  return sendFile(req,res);
}
pgInit().then(()=>http.createServer((req,res)=>route(req,res).catch(e=>{console.error(e);json(res,500,{error:'server_error'})})).listen(PORT,'0.0.0.0',()=>console.log(`Safepays v29 running: http://localhost:${PORT}`))).catch(e=>{console.error('DB init failed',e);process.exit(1)});
