const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let Pool = null;
try { ({ Pool } = require('pg')); } catch (_) { /* PostgreSQL is optional for local development. */ }
const { getMarketUsdtTry, getMarketSnapshot, calc, makeQuote } = require('./rates');
const { verifyUsdtTransfer } = require('./chain-verification');
const { makeSyntheticMembers, makeSyntheticTransactions } = require('./synthetic-finance-fixtures');

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
// Staff sessions are persistent across Render restarts/instances and use a rolling inactivity lifetime.
const configuredStaffTtlSeconds=Number(process.env.STAFF_SESSION_TTL_SECONDS);
const STAFF_SESSION_TTL_SECONDS=Number.isFinite(configuredStaffTtlSeconds)&&configuredStaffTtlSeconds>0
  ?Math.min(2592000,Math.max(3600,configuredStaffTtlSeconds))
  :2592000;
const STAFF_TTL=STAFF_SESSION_TTL_SECONDS*1000;
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
const DEFAULT_TEAM_PERMISSIONS = Object.freeze({ dashboard:true, transactions:true, reports:true, wallets:true, support:true });
const SYNTHETIC_FINANCE_SEED_ENABLED = process.env.SYNTHETIC_FINANCE_SEED_ENABLED === 'true';
const SYNTHETIC_TEST_COMMISSION_RATE = 0.03;
const ADMIN_COOKIE = 'sp_admin_session';
const OWNER_COOKIE = 'sp_owner_session';
const DEFAULT_RATE_SETTINGS = { usdTrySpread: 1, trc20FeeUsdt: 0, erc20FeeUsdt: 0, quoteTtlSeconds: 60, maxRateAgeSeconds: 300, minRate: 0, maxRate: 100000 };
const DEFAULT_REQUEST_LIMITS = { depositCooldownSeconds:120, withdrawalCooldownSeconds:120 };
const TX_CONTROL = { autoRejectMinutes: 30, lockMinutes: 5, largeApprovalThreshold: 10000 };
const txLocks = new Map();
const idempotencyCache = new Map();
const quoteStore = new Map();
const requestCooldowns = new Map();
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
const DEFAULT_PUBLIC_STATS_DISPLAY={enabled:false,intervalSeconds:90,membersMin:0,membersMax:0,activeUsersMin:0,activeUsersMax:0,transactionsMin:0,transactionsMax:0,approvedMin:0,approvedMax:0};
async function getPublicStatsDisplay(){
  if(pool){const result=await pool.query('SELECT content FROM site_content WHERE id=$1',['public-stats-display']);return {...DEFAULT_PUBLIC_STATS_DISPLAY,...(result.rows[0]?.content||{})};}
  return {...DEFAULT_PUBLIC_STATS_DISPLAY,...(readDb().publicStatsDisplay||{})};
}
async function savePublicStatsDisplay(input){
  const next={...DEFAULT_PUBLIC_STATS_DISPLAY,enabled:!!input.enabled};
  for(const [minKey,maxKey] of [['membersMin','membersMax'],['activeUsersMin','activeUsersMax'],['transactionsMin','transactionsMax'],['approvedMin','approvedMax']]){
    const min=Number(input[minKey]),max=Number(input[maxKey]);if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<min||max>1e9)throw new Error('Her sayaç için 0–1.000.000.000 aralığında tam sayı girin; üst sınır alt sınırdan küçük olamaz.');
    next[minKey]=min;next[maxKey]=max;
  }
  const interval=Number(input.intervalSeconds);if(!Number.isInteger(interval)||interval<30||interval>3600)throw new Error('Güncelleme süresi 30–3600 saniye olmalı.');next.intervalSeconds=interval;next.updatedAt=new Date().toISOString();
  if(pool)await pool.query('INSERT INTO site_content (id,content,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()',['public-stats-display',JSON.stringify(next)]);
  else{const db=readDb();db.publicStatsDisplay=next;writeDb(db);}
  publicStatsCache={at:0,value:null,expiresAt:0};return next;
}
function cleanSupportAttachments(input){
  if(input===undefined||input===null)return [];
  if(!Array.isArray(input)||input.length>4)throw new Error('support_attachment_invalid');
  let total=0;
  const files=input.map(file=>{
    const name=String(file?.name||'attachment').replace(/[\\/\r\n\0]/g,'_').slice(0,120),type=String(file?.type||''),data=String(file?.data||'');
    if(!['application/pdf','image/png','image/jpeg'].includes(type))throw new Error('support_attachment_invalid');
    const match=data.match(/^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match||match[1]!==type)throw new Error('support_attachment_invalid');
    const bytes=Buffer.from(match[2],'base64');total+=bytes.length;
    if(bytes.length<1||bytes.length>4*1024*1024||total>4*1024*1024)throw new Error('support_attachment_invalid');
    return {name,type,data:`data:${type};base64,${bytes.toString('base64')}`};
  });
  return files;
}
async function getSupportTelegramConfig(){
  if(pool){const r=await pool.query('SELECT content FROM site_content WHERE id=$1',['support-telegram']);return r.rows[0]?.content||{};}
  return readDb().supportTelegramConfig||{};
}
async function saveSupportTelegramConfig(config){
  if(pool)await pool.query('INSERT INTO site_content (id,content,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()',['support-telegram',JSON.stringify(config)]);
  else{const db=readDb();db.supportTelegramConfig=config;writeDb(db);}
  return config;
}
function publicSupportTelegramConfig(config){return {configured:!!config.botToken,tokenHint:config.botToken?`••••${config.botToken.slice(-5)}`:'',chatIds:Array.isArray(config.chatIds)?config.chatIds:[],webhookReady:!!config.webhookSecret};}
async function telegramCall(tokenValue,method,payload){
  const response=await fetch(`https://api.telegram.org/bot${tokenValue}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(`telegram_${method}_failed`);
  return result.result;
}
async function forwardSupportMessageToTelegram(ticket,message){
  try{
    const config=await getSupportTelegramConfig();if(!config.botToken||!config.chatIds?.length)return;
    const summary=`SafePays destek · ${ticket.id}\nKonu: ${ticket.subject}\nÜye: ${ticket.userName||ticket.userId}\n\n${message.message||'(Ek dosya gönderildi)'}\n\nYanıt: /reply ${ticket.id} mesajınız`;
    for(const chatId of config.chatIds){
      await telegramCall(config.botToken,'sendMessage',{chat_id:chatId,text:summary});
      for(const file of message.attachments||[]){
        const match=file.data.match(/^data:[^;]+;base64,(.+)$/);if(!match)continue;
        const form=new FormData();form.append('chat_id',String(chatId));form.append('caption',`${ticket.id} · ${file.name}`);form.append('document',new Blob([Buffer.from(match[1],'base64')],{type:file.type}),file.name);
        const response=await fetch(`https://api.telegram.org/bot${config.botToken}/sendDocument`,{method:'POST',body:form});const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok)throw new Error('telegram_send_document_failed');
      }
    }
  }catch(error){console.error('Support Telegram delivery failed:',error.message);}
}

function cleanTeamPermissions(value={}){
  return Object.fromEntries(Object.keys(DEFAULT_TEAM_PERMISSIONS).map(key=>[key,value?.[key]===true]));
}
async function getRequestLimits(){
  let stored={};
  if(pool){const result=await pool.query('SELECT content FROM site_content WHERE id=$1',['request-limits']);stored=result.rows[0]?.content||{};}
  else stored=readDb().requestLimits||{};
  const clean=value=>Math.min(86400,Math.max(0,Math.round(Number(value)||0)));
  return {depositCooldownSeconds:clean(stored.depositCooldownSeconds??DEFAULT_REQUEST_LIMITS.depositCooldownSeconds),withdrawalCooldownSeconds:clean(stored.withdrawalCooldownSeconds??DEFAULT_REQUEST_LIMITS.withdrawalCooldownSeconds)};
}
async function saveRequestLimits(value){
  const clean=field=>{const number=Number(value?.[field]);if(!Number.isInteger(number)||number<0||number>86400)throw new Error('Bekleme süreleri 0–86400 saniye arasında tam sayı olmalıdır.');return number;};
  const limits={depositCooldownSeconds:clean('depositCooldownSeconds'),withdrawalCooldownSeconds:clean('withdrawalCooldownSeconds')};
  if(pool)await pool.query('INSERT INTO site_content (id,content,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content,updated_at=NOW()',['request-limits',JSON.stringify(limits)]);
  else{const db=readDb();db.requestLimits=limits;writeDb(db);}
  return limits;
}
function makeLegacyTeamAccount(){
  if(!TEAM_ADMIN_EMAIL||!TEAM_ADMIN_PASSWORD||!TEAM_ADMIN_TOTP_SECRET)return null;
  if(TEAM_ADMIN_EMAIL.toLowerCase()===ADMIN_EMAIL.toLowerCase()||TEAM_ADMIN_PASSWORD===ADMIN_PASSWORD||TEAM_ADMIN_TOTP_SECRET===ADMIN_TOTP_SECRET)return null;
  return {id:'TEAM-ADMIN-001',email:TEAM_ADMIN_EMAIL.toLowerCase(),passwordHash:hashPassword(TEAM_ADMIN_PASSWORD),totpSecret:TEAM_ADMIN_TOTP_SECRET,twoFactorEnabled:true,active:true,permissions:{...DEFAULT_TEAM_PERMISSIONS},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
async function bootstrapTeamAccounts(){
  const existing=await getTeamAccounts();
  if(existing.length)return;
  const account=makeLegacyTeamAccount();if(!account)return;
  await saveTeamAccount(account);
}
async function getTeamAccounts(){
  if(pool){const result=await pool.query('SELECT id,email,password_hash AS "passwordHash",totp_secret AS "totpSecret",two_factor_enabled AS "twoFactorEnabled",active,permissions,wallet_limit AS "walletLimit",collateral_total AS "collateralTotal",collateral_balance AS "collateralBalance",commission_percent AS "commissionPercent",allow_self_disable AS "allowSelfDisable",collateral_auto_pause AS "collateralAutoPause",collateral_pause_percent AS "collateralPausePercent",collateral_paused AS "collateralPaused",deposits_paused AS "depositsPaused",require_chain_verification AS "requireChainVerification",created_at AS "createdAt",updated_at AS "updatedAt" FROM team_accounts ORDER BY created_at');return result.rows.map(account=>({...account,walletLimit:Number(account.walletLimit||0),collateralTotal:Number(account.collateralTotal||0),collateralBalance:Number(account.collateralBalance||0),commissionPercent:Number(account.commissionPercent??3),collateralPausePercent:Number(account.collateralPausePercent||80),allowSelfDisable:!!account.allowSelfDisable,collateralAutoPause:!!account.collateralAutoPause,collateralPaused:!!account.collateralPaused,depositsPaused:!!account.depositsPaused,requireChainVerification:account.requireChainVerification!==false,permissions:cleanTeamPermissions(account.permissions)}));}
  return (readDb().teamAccounts||[]).map(account=>({...account,walletLimit:Number(account.walletLimit||0),collateralTotal:Number(account.collateralTotal||0),collateralBalance:Number(account.collateralBalance||0),commissionPercent:Number(account.commissionPercent??3),collateralPausePercent:Number(account.collateralPausePercent||80),allowSelfDisable:!!account.allowSelfDisable,collateralAutoPause:!!account.collateralAutoPause,collateralPaused:!!account.collateralPaused,depositsPaused:!!account.depositsPaused,requireChainVerification:account.requireChainVerification!==false,permissions:cleanTeamPermissions(account.permissions)}));
}
async function saveTeamAccount(account){
  if(pool){await pool.query('INSERT INTO team_accounts (id,email,password_hash,totp_secret,two_factor_enabled,active,permissions,wallet_limit,collateral_total,collateral_balance,commission_percent,allow_self_disable,collateral_auto_pause,collateral_pause_percent,collateral_paused,deposits_paused,require_chain_verification,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,totp_secret=EXCLUDED.totp_secret,two_factor_enabled=EXCLUDED.two_factor_enabled,active=EXCLUDED.active,permissions=EXCLUDED.permissions,wallet_limit=EXCLUDED.wallet_limit,collateral_total=EXCLUDED.collateral_total,collateral_balance=EXCLUDED.collateral_balance,commission_percent=EXCLUDED.commission_percent,allow_self_disable=EXCLUDED.allow_self_disable,collateral_auto_pause=EXCLUDED.collateral_auto_pause,collateral_pause_percent=EXCLUDED.collateral_pause_percent,collateral_paused=EXCLUDED.collateral_paused,deposits_paused=EXCLUDED.deposits_paused,require_chain_verification=EXCLUDED.require_chain_verification,updated_at=EXCLUDED.updated_at',[account.id,account.email,account.passwordHash,account.totpSecret||null,!!account.twoFactorEnabled,account.active!==false,JSON.stringify(cleanTeamPermissions(account.permissions)),Number(account.walletLimit||0),Number(account.collateralTotal||0),Number(account.collateralBalance||0),Number(account.commissionPercent||0),!!account.allowSelfDisable,!!account.collateralAutoPause,Number(account.collateralPausePercent||80),!!account.collateralPaused,!!account.depositsPaused,account.requireChainVerification!==false,account.createdAt||new Date().toISOString(),account.updatedAt||new Date().toISOString()]);return;}
  const db=readDb();db.teamAccounts=Array.isArray(db.teamAccounts)?db.teamAccounts:[];const index=db.teamAccounts.findIndex(item=>item.id===account.id);const clean={...account,permissions:cleanTeamPermissions(account.permissions),updatedAt:account.updatedAt||new Date().toISOString()};if(index<0)db.teamAccounts.push(clean);else db.teamAccounts[index]=clean;writeDb(db);
}
function publicTeamAccount(account,metrics={}){const commissionPercent=Number(account.commissionPercent??3),collateralTotal=Number(account.collateralTotal||0),collateralExposure=Number(metrics.collateralExposure||0),collateralAutoPause=!!account.collateralAutoPause,collateralPausePercent=Number(account.collateralPausePercent||80),atPauseThreshold=collateralTotal>0&&collateralExposure>=collateralTotal*(collateralAutoPause?collateralPausePercent:100)/100,collateralPaused=!!account.collateralPaused||atPauseThreshold;return {id:account.id,email:account.email,active:account.active!==false,depositsPaused:!!account.depositsPaused,acceptingDeposits:account.active!==false&&!account.depositsPaused&&!collateralPaused,twoFactorEnabled:!!account.twoFactorEnabled,twoFactorSetupPending:!!account.totpSecret&&!account.twoFactorEnabled,permissions:cleanTeamPermissions(account.permissions),walletLimit:Number(account.walletLimit||0),collateralTotal,collateralBalance:Number(account.collateralBalance||0),collateralExposure,collateralAvailable:Math.max(0,collateralTotal-collateralExposure),commissionPercent,commissionEarned:Number(metrics.commissionEarned||0)*commissionPercent/100,allowSelfDisable:!!account.allowSelfDisable,collateralAutoPause,collateralPausePercent,collateralPaused,requireChainVerification:account.requireChainVerification!==false,createdAt:account.createdAt||null,updatedAt:account.updatedAt||null};}
function readTeamControls(value={},current={},creating=false){
  const number=(key,fallback)=>value[key]===undefined?Number(current[key]??fallback):Number(value[key]);
  const walletLimit=number('walletLimit',0),collateralTotal=number('collateralTotal',0),collateralBalance=number('collateralBalance',creating?collateralTotal:0),collateralPausePercent=number('collateralPausePercent',80),commissionPercent=number('commissionPercent',3);
  if(!Number.isInteger(walletLimit)||walletLimit<0||walletLimit>5000||![collateralTotal,collateralBalance,collateralPausePercent,commissionPercent].every(Number.isFinite)||collateralTotal<0||collateralBalance<0||collateralPausePercent<1||collateralPausePercent>100||commissionPercent<0||commissionPercent>100)return null;
  const allowSelfDisable=value.allowSelfDisable===undefined?!!current.allowSelfDisable:!!value.allowSelfDisable;
  const collateralAutoPause=value.collateralAutoPause===undefined?!!current.collateralAutoPause:!!value.collateralAutoPause;
  if(collateralAutoPause&&collateralTotal<=0)return null;
  return {walletLimit,collateralTotal,collateralBalance,commissionPercent,allowSelfDisable,collateralAutoPause,collateralPausePercent};
}
async function clearTeamSessions(accountId){
  if(pool){await pool.query("DELETE FROM staff_sessions WHERE portal='admin' AND subject_id=$1",[accountId]);return;}
  for(const [sessionId,session] of adminSessions.entries())if(session.adminId===accountId)adminSessions.delete(sessionId);
}
async function clearOwnerSessions(){
  if(pool){await pool.query("DELETE FROM staff_sessions WHERE portal='owner' AND subject_id='OWNER-001'");return;}
  ownerSessions.clear();
}
function teamPermissionForPath(path){
  if(path==='/api/admin/users')return 'transactions';
  if(path.startsWith('/api/admin/user-center')||path.startsWith('/api/admin/user/')||path==='/api/admin/kyc'||path==='/api/admin/kyc/decision')return 'members';
  if(path==='/api/admin/audit')return 'audit';
  if(path.startsWith('/api/admin/transactions'))return 'transactions';
  if(path.startsWith('/api/admin/wallet-addresses'))return 'wallets';
  if(path.startsWith('/api/admin/support'))return 'support';
  if(path==='/api/admin/stats')return 'dashboard';
  if(path.startsWith('/api/admin/finance/')||path==='/api/admin/ledger')return 'reports';
  return 'dashboard';
}

async function pgInit(){
  if(!pool){await bootstrapTeamAccounts();return;}
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
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS test_run_id TEXT');
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
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS test_run_id TEXT');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS team_account_id TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transactions_test_run ON transactions(test_run_id,created_at) WHERE is_synthetic=TRUE');
  await pool.query(`CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), transaction_id TEXT, direction TEXT NOT NULL,
    amount NUMERIC(20,8) NOT NULL, currency TEXT NOT NULL DEFAULT 'USDT', balance_before NUMERIC(20,8) NOT NULL,
    balance_after NUMERIC(20,8) NOT NULL, reason TEXT NOT NULL, metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger_entries(transaction_id)');
  await pool.query('ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS test_run_id TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_ledger_test_run ON ledger_entries(test_run_id,created_at) WHERE is_synthetic=TRUE');
  await pool.query(`CREATE TABLE IF NOT EXISTS synthetic_finance_runs (
    id TEXT PRIMARY KEY, target_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
    member_count INTEGER NOT NULL, transaction_count INTEGER NOT NULL, commission_rate NUMERIC(8,6) NOT NULL
  )`);
  await pool.query('CREATE TABLE IF NOT EXISTS site_content (id TEXT PRIMARY KEY, content JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(20,8)');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS received_amount NUMERIC(20,8)');
  await pool.query(`CREATE TABLE IF NOT EXISTS wallet_addresses (
    id TEXT PRIMARY KEY, network TEXT NOT NULL CHECK (network IN ('TRC20','ERC20')), address TEXT NOT NULL,
    label TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, team_id TEXT,
    created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (network,address)
  )`);
  // Older deployed databases may have this table without the rotation/audit columns.
  // CREATE TABLE IF NOT EXISTS does not add columns to an existing table.
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS team_id TEXT');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS created_by TEXT');
  await pool.query("UPDATE wallet_addresses SET created_by='system:legacy' WHERE created_by IS NULL OR BTRIM(created_by)=''");
  await pool.query("ALTER TABLE wallet_addresses ALTER COLUMN created_by SET DEFAULT 'system:legacy'");
  await pool.query('ALTER TABLE wallet_addresses ALTER COLUMN created_by SET NOT NULL');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS min_deposit_amount NUMERIC(20,8)');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS max_deposit_amount NUMERIC(20,8)');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS min_deposit_owner_set BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE wallet_addresses ADD COLUMN IF NOT EXISTS max_deposit_owner_set BOOLEAN NOT NULL DEFAULT FALSE');
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
  await pool.query("ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_support_ticket_user_updated ON support_tickets(user_id,updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created ON support_messages(ticket_id,created_at)');
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, action TEXT NOT NULL, actor TEXT NOT NULL, meta JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS team_accounts (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, totp_secret TEXT,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE,
    permissions JSONB NOT NULL DEFAULT '{"dashboard":true,"transactions":true,"reports":true,"wallets":true,"support":true}'::jsonb,
    wallet_limit INTEGER NOT NULL DEFAULT 0, collateral_total NUMERIC(20,8) NOT NULL DEFAULT 0,
    collateral_balance NUMERIC(20,8) NOT NULL DEFAULT 0, allow_self_disable BOOLEAN NOT NULL DEFAULT FALSE,
    commission_percent NUMERIC(5,2) NOT NULL DEFAULT 3,
    collateral_auto_pause BOOLEAN NOT NULL DEFAULT FALSE, collateral_pause_percent NUMERIC(5,2) NOT NULL DEFAULT 80,
    collateral_paused BOOLEAN NOT NULL DEFAULT FALSE,
    deposits_paused BOOLEAN NOT NULL DEFAULT FALSE,
    require_chain_verification BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS wallet_limit INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS collateral_total NUMERIC(20,8) NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS collateral_balance NUMERIC(20,8) NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS allow_self_disable BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS collateral_auto_pause BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS collateral_pause_percent NUMERIC(5,2) NOT NULL DEFAULT 80');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS collateral_paused BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS deposits_paused BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS require_chain_verification BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE team_accounts ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 3');
  await pool.query(`CREATE TABLE IF NOT EXISTS staff_sessions (
    token_hash TEXT PRIMARY KEY, portal TEXT NOT NULL CHECK (portal IN ('admin','owner')),
    subject_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_staff_sessions_expiry ON staff_sessions(expires_at)');
  await bootstrapTeamAccounts();
}
async function getUsers(){
  if(!pool) return readDb().users;
  const r=await pool.query('SELECT id, first_name AS "firstName", last_name AS "lastName", email, username, phone, password_hash AS "passwordHash", role, balance, referral_earnings AS "referralEarnings", referral_code AS "referralCode", referred_by AS "referredBy", two_factor_enabled AS "twoFactorEnabled", phone_verified AS "phoneVerified", email_verified AS "emailVerified", totp_secret AS "totpSecret", kyc_status AS "kycStatus", kyc_name AS "kycName", kyc_submitted_at AS "kycSubmittedAt", created_at AS "createdAt", security_status AS "securityStatus", withdrawal_frozen AS "withdrawalFrozen", deposit_frozen AS "depositFrozen", security_reason AS "securityReason", security_updated_at AS "securityUpdatedAt", is_test_account AS "isTestAccount", is_synthetic AS "isSynthetic", test_run_id AS "testRunId" FROM users');
  return r.rows;
}
async function getTransactions(){
  if(!pool) return readDb().transactions;
  const r=await pool.query('SELECT id, user_id AS "userId", type, amount, requested_amount AS "requestedAmount", received_amount AS "receivedAmount", currency, network, status, created_at AS "createdAt", tx_hash AS "txHash", address, wallet_id AS "walletId", team_account_id AS "teamAccountId", request_key AS "requestKey", locked_by AS "lockedBy", locked_at AS "lockedAt", decision_by AS "decisionBy", decision_at AS "decisionAt", expires_at AS "expiresAt", is_synthetic AS "isSynthetic", test_run_id AS "testRunId" FROM transactions ORDER BY created_at DESC');
  return r.rows;
}
async function getLedger(userId){
  if(!pool){const rows=readDb().ledger||[]; return rows.filter(x=>!userId||x.userId===userId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));}
  const q=userId ? await pool.query('SELECT id, user_id AS "userId", transaction_id AS "transactionId", direction, amount, currency, balance_before AS "balanceBefore", balance_after AS "balanceAfter", reason, metadata, created_at AS "createdAt", is_synthetic AS "isSynthetic", test_run_id AS "testRunId" FROM ledger_entries WHERE user_id=$1 ORDER BY created_at DESC',[userId]) : await pool.query('SELECT id, user_id AS "userId", transaction_id AS "transactionId", direction, amount, currency, balance_before AS "balanceBefore", balance_after AS "balanceAfter", reason, metadata, created_at AS "createdAt", is_synthetic AS "isSynthetic", test_run_id AS "testRunId" FROM ledger_entries ORDER BY created_at DESC');
  return q.rows;
}
async function addLedgerEntry({userId,transactionId=null,direction,amount,currency='USDT',reason,metadata={},isSynthetic=false,testRunId=null,createdAt=new Date().toISOString()} , client=null, dbState=null){
  const amt=Number(amount); if(!Number.isFinite(amt)||amt<=0) throw new Error('invalid_ledger_amount');
  let before;
  if(pool){const q=client||pool;const result=await q.query(`SELECT balance FROM users WHERE id=$1${client?' FOR UPDATE':''}`,[userId]);if(!result.rows[0])throw new Error('user_not_found');before=Number(result.rows[0].balance||0);}
  else{const user=(dbState?.users||await getUsers()).find(x=>String(x.id)===String(userId));if(!user)throw new Error('user_not_found');before=Number(user.balance||0);}
  const after=Number((direction==='credit'?before+amt:before-amt).toFixed(8));
  if(after<0) throw new Error('negative_balance');
  const entry={id:`LED-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,userId,transactionId,direction,amount:amt,currency,balanceBefore:before,balanceAfter:after,reason,metadata,createdAt,isSynthetic:!!isSynthetic,testRunId:testRunId||null};
  if(pool){ const q=client||pool; await q.query('INSERT INTO ledger_entries (id,user_id,transaction_id,direction,amount,currency,balance_before,balance_after,reason,metadata,created_at,is_synthetic,test_run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[entry.id,userId,transactionId,direction,amt,currency,before,after,reason,JSON.stringify(metadata),entry.createdAt,!!isSynthetic,testRunId||null]); await q.query('UPDATE users SET balance=$1 WHERE id=$2',[after,userId]); }
  else { const db=dbState||readDb(); const u=db.users.find(x=>String(x.id)===String(userId)); if(!u) throw new Error('user_not_found'); u.balance=after; db.ledger=db.ledger||[]; db.ledger.unshift(entry); if(!dbState)writeDb(db); }
  return entry;
}
async function insertUser(user, client=null){
  if(!pool){const db=readDb();db.users.push(user);writeDb(db);return;}
  await (client||pool).query('INSERT INTO users (id,first_name,last_name,email,username,phone,password_hash,role,balance,referral_earnings,referral_code,referred_by,two_factor_enabled,phone_verified,email_verified,created_at,is_test_account,is_synthetic,test_run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)',[user.id,user.firstName,user.lastName,user.email,user.username,user.phone,user.passwordHash,user.role,user.balance,user.referralEarnings,user.referralCode,user.referredBy||null,user.twoFactorEnabled,user.phoneVerified,user.emailVerified,user.createdAt,!!user.isTestAccount,!!user.isSynthetic,user.testRunId||null]);
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
function body(req,maxBytes=2e6){ return new Promise((resolve,reject)=>{let s='',tooLarge=false;req.on('data',c=>{if(tooLarge)return;s+=c;if(s.length>maxBytes){tooLarge=true;s='';}});req.on('end',()=>{if(tooLarge){const e=new Error('payload_too_large');e.statusCode=413;reject(e);return;}try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)}); }
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
function safeUser(u){const {passwordHash,totpSecret,isTestAccount,isSynthetic,testRunId,...safe}=u; return safe;}
function safeTeamMember(u){return {id:u.id,firstName:u.firstName||'',lastName:u.lastName||'',username:u.username||'',kycStatus:u.kycStatus||'not_started',kycSubmittedAt:u.kycSubmittedAt||null,createdAt:u.createdAt||null};}
function safeTransaction(tx){const {isSynthetic,testRunId,...safe}=tx;return safe;}
function safeLedgerEntry(entry){const {isSynthetic,testRunId,...safe}=entry;return safe;}
function chainVerificationMessage(reason,network){
  const networkName=String(network||'').toUpperCase();
  const messages={
    missing_tx_hash:'Transferin blokzincirdeki işlem kimliği girilmemiş.',
    invalid_tx_hash:networkName==='TRC20'
      ?'TRC20 işlem kimliği 64 hexadecimal karakter olmalı. Cüzdan adresini değil, transferin TX ID bilgisini girin.'
      :'ERC20 işlem kimliği 0x ile başlayan 64 hexadecimal karakter olmalı. Cüzdan adresini değil, transferin TX ID bilgisini girin.',
    transaction_not_solidified:'TRON transferi henüz kesinleşmedi. Biraz sonra yeniden kontrol edin.',
    execution_status_unavailable:'Ağ transferinin sonucu henüz doğrulanamadı. Biraz sonra yeniden deneyin.',
    transaction_not_mined:'Ethereum transferi henüz bloğa alınmadı.',
    transaction_not_finalized:'Ethereum transferi henüz kesinleşmedi. Biraz sonra yeniden kontrol edin.',
    transaction_failed:'Blokzincir transferi başarısız olmuş.',
    usdt_transfer_not_found:'İşlem içinde doğrulanabilir USDT transferi bulunamadı.',
    recipient_mismatch:'USDT transferi bu talepteki alıcı adrese gönderilmemiş.',
    amount_mismatch:'Blokzincirdeki USDT tutarı talep tutarıyla uyuşmuyor.',
    wrong_chain:'Transfer Ethereum ana ağında gerçekleşmemiş.',
    ethereum_rpc_not_configured:'Ethereum doğrulaması şu anda yapılandırılmamış. Sistem yöneticisinin RPC ayarını kontrol etmesi gerekiyor.',
    provider_timeout:'Blokzincir sağlayıcısından zamanında yanıt alınamadı. Biraz sonra yeniden deneyin.',
    provider_unavailable:'Blokzincir sağlayıcısına şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.',
    provider_response_error:'Blokzincir sağlayıcısından doğrulanabilir yanıt alınamadı.',
    provider_http_429:'Blokzincir sağlayıcısının istek sınırına ulaşıldı. Biraz sonra yeniden deneyin.',
    invalid_tron_address:'Kayıtlı TRON alıcı adresi doğrulanamadı.',
    invalid_usdt_amount:'Tutar, USDT transfer hassasiyetiyle uyuşmuyor.'
  };
  const detail=messages[reason]||'Blokzincir transferi doğrulanamadı. Girilen işlem kimliğini, ağı, alıcı adresi ve tutarı kontrol edin.';
  return `${detail} Transfer kesinleşmeden işlem onaylanamaz.`;
}
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
function staffTokenHash(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
async function saveStaffSession(value,portal,session){
  if(pool){
    await pool.query('INSERT INTO staff_sessions (token_hash,portal,subject_id,email,role,permissions,expires_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',[staffTokenHash(value),portal,portal==='owner'?session.ownerId:session.adminId,session.email,session.role,JSON.stringify(session.permissions||{}),new Date(session.expires).toISOString()]);
    return;
  }
  (portal==='owner'?ownerSessions:adminSessions).set(value,session);
}
async function deleteStaffSession(value,portal){
  if(!value)return;
  if(pool){await pool.query('DELETE FROM staff_sessions WHERE token_hash=$1 AND portal=$2',[staffTokenHash(value),portal]);return;}
  (portal==='owner'?ownerSessions:adminSessions).delete(value);
}
async function readStaffSession(req,cookieName,portal){
  const value=parseCookies(req)[cookieName]||'';
  if(!value)return null;
  if(!pool){
    const store=portal==='owner'?ownerSessions:adminSessions,session=readSession(req,cookieName,store);
    if(session)session.expires=Date.now()+STAFF_TTL;
    return session;
  }
  const result=await pool.query(`UPDATE staff_sessions SET expires_at=NOW()+($3::integer * INTERVAL '1 second') WHERE token_hash=$1 AND portal=$2 AND expires_at>NOW() RETURNING subject_id AS "subjectId",email,role,permissions,expires_at AS "expiresAt"`,[staffTokenHash(value),portal,STAFF_SESSION_TTL_SECONDS]);
  const row=result.rows[0];if(!row){await pool.query('DELETE FROM staff_sessions WHERE token_hash=$1 AND portal=$2',[staffTokenHash(value),portal]);return null;}
  const expires=new Date(row.expiresAt).getTime();
  return portal==='owner'?{ownerId:row.subjectId,email:row.email,role:row.role,expires}:{adminId:row.subjectId,email:row.email,role:row.role,permissions:cleanTeamPermissions(row.permissions),expires};
}
async function adminAuth(req){return readStaffSession(req,ADMIN_COOKIE,'admin');}
async function ownerAuth(req){return readStaffSession(req,OWNER_COOKIE,'owner');}
function clearCookie(name){return name+'=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'+(process.env.NODE_ENV==='production'?'; Secure':'');}
function sessionCookie(name,value,ttl=TTL){return name+'='+encodeURIComponent(value)+'; Max-Age='+Math.floor(ttl/1000)+'; Path=/; HttpOnly; SameSite=Lax'+(process.env.NODE_ENV==='production'?'; Secure':'');}
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
  fs.stat(file,(err,st)=>{if(err||!st.isFile())return json(res,404,{error:'not_found'});const ext=path.extname(file).toLowerCase();const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);});
}
function redirect(res,location){res.writeHead(302,{'Location':location,'Cache-Control':'no-store'});res.end();}

async function insertTransaction(tx, client=null){
  if(!pool){const db=readDb();db.transactions.unshift(tx);writeDb(db);return;}
  await (client||pool).query('INSERT INTO transactions (id,user_id,type,amount,requested_amount,received_amount,currency,network,status,created_at,tx_hash,address,wallet_id,team_account_id,request_key,locked_by,locked_at,decision_by,decision_at,expires_at,is_synthetic,test_run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)',[tx.id,tx.userId,tx.type,tx.amount,tx.requestedAmount??tx.amount,tx.receivedAmount??null,tx.currency,tx.network,tx.status,tx.createdAt,tx.txHash||null,tx.address||null,tx.walletId||null,tx.teamAccountId||null,tx.requestKey||null,tx.lockedBy||null,tx.lockedAt||null,tx.decisionBy||null,tx.decisionAt||null,tx.expiresAt||null,!!tx.isSynthetic,tx.testRunId||null]);
}
async function syncTeamCollateral({teamId,exposure,client=null,dbState=null,at}){
  let account;
  if(client){const locked=await client.query('SELECT id,collateral_total AS "collateralTotal",collateral_auto_pause AS "collateralAutoPause",collateral_pause_percent AS "collateralPausePercent",active,collateral_paused AS "collateralPaused" FROM team_accounts WHERE id=$1 FOR UPDATE',[teamId]);account=locked.rows[0];}
  else account=(dbState?.teamAccounts||[]).find(item=>item.id===teamId);
  if(!account)throw new Error('team_account_not_found');
  const total=Number(account.collateralTotal||0);
  if(total>0&&exposure>total+1e-8)throw new Error('team_collateral_limit_exceeded');
  const threshold=total*Number(account.collateralPausePercent||80)/100,pauseLimit=account.collateralAutoPause?threshold:total;
  const shouldPause=total>0&&!!account.collateralAutoPause&&exposure>=threshold-1e-8;
  const wasPaused=!!account.collateralPaused;
  const shouldResume=wasPaused&&!shouldPause&&total>0&&exposure<pauseLimit-1e-8;
  if(client){
    await client.query('UPDATE team_accounts SET collateral_paused=$1,updated_at=$2 WHERE id=$3',[shouldPause,at,teamId]);
  }else{
    account.collateralPaused=shouldPause;
    account.updatedAt=at;
  }
  return {autoPausedTeamAccountId:shouldPause?teamId:null,autoResumedTeamAccountId:shouldResume?teamId:null};
}
async function applyTransactionDecision({tx,decision,approvedAmount,actor,decisionAt,payoutTxHash=null,client=null,dbState=null,teamAccountId=null}){
  const requestedAmount=Number(tx.requestedAmount??tx.amount);
  const amountChanged=Math.abs(Number(approvedAmount)-requestedAmount)>1e-8;
  let autoPausedTeamAccountId=null,autoResumedTeamAccountId=null;
  if(decision==='approved'&&tx.type==='deposit'&&tx.walletId){
    let depositTeamId=tx.teamAccountId||null;
    if(!depositTeamId&&client){const wallet=await client.query('SELECT team_id AS "teamId" FROM wallet_addresses WHERE id=$1',[tx.walletId]);depositTeamId=wallet.rows[0]?.teamId||null;}
    else if(!depositTeamId)depositTeamId=(dbState?.walletAddresses||[]).find(wallet=>wallet.id===tx.walletId)?.teamId||null;
    if(depositTeamId){
      const currentExposure=client?await getTeamCollateralExposure(client,depositTeamId):teamCollateralMetrics(depositTeamId,dbState?.transactions||[],dbState?.walletAddresses||[],dbState?.depositIntents||[]).collateralExposure;
      const nextExposure=Math.max(0,currentExposure-requestedAmount+Number(approvedAmount));
      const synced=await syncTeamCollateral({teamId:depositTeamId,exposure:nextExposure,client,dbState,at:decisionAt});
      autoPausedTeamAccountId=synced.autoPausedTeamAccountId;autoResumedTeamAccountId=synced.autoResumedTeamAccountId;
    }
  }
  if(decision==='approved'&&tx.type==='withdrawal'&&teamAccountId){
    const currentExposure=client?await getTeamCollateralExposure(client,teamAccountId):teamCollateralMetrics(teamAccountId,dbState?.transactions||[],dbState?.walletAddresses||[],dbState?.depositIntents||[]).collateralExposure;
    const nextExposure=Math.max(0,currentExposure-Number(approvedAmount));
    const synced=await syncTeamCollateral({teamId:teamAccountId,exposure:nextExposure,client,dbState,at:decisionAt});
    autoPausedTeamAccountId=synced.autoPausedTeamAccountId;autoResumedTeamAccountId=synced.autoResumedTeamAccountId;
  }
  if(client){
    const result=await client.query("UPDATE transactions SET status=$1,amount=$2,requested_amount=COALESCE(requested_amount,$3),received_amount=$4,decision_by=$5,decision_at=$6,locked_by=NULL,locked_at=NULL,tx_hash=COALESCE($7,tx_hash),team_account_id=COALESCE($8,team_account_id) WHERE id=$9 AND status='pending'",[decision,approvedAmount,requestedAmount,approvedAmount,actor,decisionAt,payoutTxHash,tx.type==='withdrawal'?teamAccountId:null,tx.id]);
    if(!result.rowCount)throw new Error('transaction_not_pending');
  }else if(dbState){
    const row=(dbState.transactions||[]).find(x=>String(x.id)===String(tx.id));
    if(!row||row.status!=='pending')throw new Error('transaction_not_pending');
    row.requestedAmount=Number(row.requestedAmount??row.amount);row.receivedAmount=approvedAmount;row.amount=approvedAmount;row.status=decision;row.decisionBy=actor;row.decisionAt=decisionAt;row.lockedBy=null;row.lockedAt=null;if(payoutTxHash)row.txHash=payoutTxHash;if(tx.type==='withdrawal'&&teamAccountId)row.teamAccountId=teamAccountId;
  }else throw new Error('decision_storage_context_required');

  if(decision==='approved'){
    await addLedgerEntry({
      userId:tx.userId,transactionId:tx.id,direction:tx.type==='deposit'?'credit':'debit',amount:approvedAmount,
      currency:tx.currency||'USDT',reason:tx.type==='deposit'?'deposit_approved':'withdrawal_approved',
      metadata:{network:tx.network,admin:actor,requestedAmount,approvedAmount,amountChanged,payoutTxHash,testRunId:tx.testRunId||null},
      isSynthetic:!!tx.isSynthetic,testRunId:tx.testRunId||null,createdAt:decisionAt
    },client,dbState);
  }
  return {requestedAmount,approvedAmount,amountChanged,payoutTxHash,autoPausedTeamAccountId,autoResumedTeamAccountId};
}
function utcDateKey(value){const date=value?new Date(value):new Date();return Number.isNaN(date.getTime())?'':date.toISOString().slice(0,10);}
function validDateKey(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&utcDateKey(`${value}T00:00:00.000Z`)===value;}
function defaultFinanceRange(){const end=new Date();end.setUTCHours(0,0,0,0);const start=new Date(end.getTime()-89*86400000);return {startDate:utcDateKey(start),endDate:utcDateKey(end)};}
async function getSyntheticFinanceRun(runId){
  if(pool){const result=await pool.query('SELECT id,target_user_id AS "targetUserId",created_at AS "createdAt",start_date AS "startDate",end_date AS "endDate",member_count AS "memberCount",transaction_count AS "transactionCount",commission_rate AS "commissionRate" FROM synthetic_finance_runs WHERE id=$1',[runId]);return result.rows[0]||null;}
  return (readDb().syntheticFinanceRuns||[]).find(run=>run.id===runId)||null;
}
function calculateSettlement(transactions,{commissionRate=0,commissionByTeam=null,teamForTransaction=()=>null}={}){
  let deposit=0,withdrawal=0,commission=0;
  for(const tx of transactions){
    if(tx.isSynthetic||tx.status!=='approved')continue;
    const amount=Number(tx.amount||0);
    if(tx.type==='deposit'){
      deposit+=amount;
      const rate=commissionByTeam?Number(commissionByTeam.get(teamForTransaction(tx))||0)/100:commissionRate;
      commission+=amount*rate;
    }else if(tx.type==='withdrawal')withdrawal+=amount;
  }
  const cash=deposit-withdrawal,receivable=cash-commission;
  return {deposit,withdrawal,commission,cash,receivable,commissionPercent:deposit?commission/deposit*100:0};
}
function buildFinanceReconciliation(transactions,{startDate,endDate,runId=null,commissionRate=0,commissionEnabled=!!runId,commissionPercent=Number(commissionRate||0)*100,commissionByTeam=null,teamForTransaction=()=>null}){
  const start=new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end=new Date(`${endDate}T00:00:00.000Z`).getTime();
  const dayCount=Math.round((end-start)/86400000)+1;
  const days=Array.from({length:dayCount},(_,index)=>({date:utcDateKey(start+index*86400000),deposit:0,withdrawal:0,commission:0,cash:0,receivable:0,count:0,approvedCount:0,pendingCount:0,rejectedCount:0,depositCount:0}));
  const byDate=new Map(days.map(day=>[day.date,day]));
  const inScope=tx=>runId?tx.isSynthetic===true&&tx.testRunId===runId:!tx.isSynthetic;
  for(const tx of transactions){
    if(!inScope(tx))continue;
    const day=byDate.get(utcDateKey(tx.decisionAt||tx.createdAt));if(!day)continue;
    day.count++;
    if(tx.status==='pending')day.pendingCount++;
    if(tx.status==='rejected'||tx.status==='auto-rejected')day.rejectedCount++;
    if(tx.status!=='approved')continue;
    day.approvedCount++;
    const amount=Number(tx.amount||0);
    if(tx.type==='deposit'){day.deposit+=amount;day.depositCount++;if(commissionByTeam)day.commission+=amount*Number(commissionByTeam.get(teamForTransaction(tx))||0)/100;}
    else if(tx.type==='withdrawal')day.withdrawal+=amount;
  }
  for(const day of days){if(!commissionByTeam)day.commission=day.deposit*commissionRate;day.cash=day.deposit-day.withdrawal;day.receivable=day.cash-day.commission;}
  const totals=days.reduce((sum,day)=>({
    deposit:sum.deposit+day.deposit,withdrawal:sum.withdrawal+day.withdrawal,commission:sum.commission+day.commission,
    cash:sum.cash+day.cash,receivable:sum.receivable+day.receivable,count:sum.count+day.count,
    approvedCount:sum.approvedCount+day.approvedCount,pendingCount:sum.pendingCount+day.pendingCount,
    rejectedCount:sum.rejectedCount+day.rejectedCount,depositCount:sum.depositCount+day.depositCount
  }),{deposit:0,withdrawal:0,commission:0,cash:0,receivable:0,count:0,approvedCount:0,pendingCount:0,rejectedCount:0,depositCount:0});
  totals.averageDeposit=totals.depositCount?totals.deposit/totals.depositCount:0;
  return {startDate,endDate,testRunId:runId,commissionRate,commissionPercent,commissionEnabled,days,totals};
}
function isProductionUser(user){return !user?.isSynthetic&&!user?.isTestAccount;}
function isProductionTransaction(tx){return !tx?.isSynthetic;}
let publicStatsCache={at:0,value:null,expiresAt:0};
async function getPublicStats(){
  const now=Date.now();
  if(publicStatsCache.value&&now<publicStatsCache.expiresAt)return publicStatsCache.value;
  let stats;
  if(pool){
    const [members,transactions]=await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role='member' AND is_synthetic=FALSE AND is_test_account=FALSE"),
      pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status='approved')::int AS approved,COUNT(DISTINCT user_id) FILTER (WHERE created_at>=NOW()-INTERVAL '30 days')::int AS active_30_days FROM transactions WHERE is_synthetic=FALSE")
    ]);
    stats={members:members.rows[0].count,transactions:transactions.rows[0].total,approvedTransactions:transactions.rows[0].approved,activeUsers30Days:transactions.rows[0].active_30_days};
  }else{
    const [users,transactions]=await Promise.all([getUsers(),getTransactions()]);
    const productionUsers=users.filter(user=>user.role==='member'&&isProductionUser(user));
    const productionTransactions=transactions.filter(isProductionTransaction);
    const cutoff=now-30*86400000;
    stats={members:productionUsers.length,transactions:productionTransactions.length,approvedTransactions:productionTransactions.filter(tx=>tx.status==='approved').length,activeUsers30Days:new Set(productionTransactions.filter(tx=>new Date(tx.createdAt).getTime()>=cutoff).map(tx=>String(tx.userId))).size};
  }
  const display=await getPublicStatsDisplay();
  const result=display.enabled?{
    members:display.membersMin+Math.floor(Math.random()*(display.membersMax-display.membersMin+1)),
    activeUsers30Days:display.activeUsersMin+Math.floor(Math.random()*(display.activeUsersMax-display.activeUsersMin+1)),
    transactions:display.transactionsMin+Math.floor(Math.random()*(display.transactionsMax-display.transactionsMin+1)),
    approvedTransactions:display.approvedMin+Math.floor(Math.random()*(display.approvedMax-display.approvedMin+1)),
    simulation:true,nextRefreshSeconds:display.intervalSeconds,updatedAt:new Date(now).toISOString()
  }:{...stats,simulation:false,nextRefreshSeconds:30,updatedAt:new Date(now).toISOString()};
  publicStatsCache={at:now,value:result,expiresAt:now+(display.enabled?display.intervalSeconds:30)*1000};
  return result;
}
async function getWalletAddresses({activeOnly=false}={}){
  if(!pool){const db=readDb(),rows=db.walletAddresses||[],teams=new Map((db.teamAccounts||[]).map(account=>[account.id,account]));return rows.filter(wallet=>{if(!activeOnly)return true;if(!wallet.active)return false;if(!wallet.teamId)return true;const team=teams.get(wallet.teamId);return !!team&&team.active!==false&&!team.depositsPaused&&!team.collateralPaused;});}
  const r=await pool.query(`SELECT w.id,w.network,w.address,w.label,w.active,w.team_id AS "teamId",w.created_by AS "createdBy",w.created_at AS "createdAt",w.updated_at AS "updatedAt",w.use_count AS "useCount",w.last_used_at AS "lastUsedAt",w.min_deposit_amount AS "minDepositAmount",w.max_deposit_amount AS "maxDepositAmount",w.min_deposit_owner_set AS "minDepositOwnerSet",w.max_deposit_owner_set AS "maxDepositOwnerSet" FROM wallet_addresses w LEFT JOIN team_accounts t ON t.id=w.team_id ${activeOnly?'WHERE w.active=TRUE AND (w.team_id IS NULL OR (t.active=TRUE AND t.deposits_paused=FALSE AND t.collateral_paused=FALSE))':''} ORDER BY w.created_at DESC`);
  return r.rows;
}
async function walletTeamAllowed(teamId,currentWalletId=null){
  if(!teamId)return true;
  const accounts=await getTeamAccounts(),team=accounts.find(account=>account.id===teamId);if(!team)return false;
  const limit=Number(team.walletLimit||0);if(!limit)return true;
  const wallets=await getWalletAddresses();return wallets.filter(wallet=>wallet.teamId===teamId&&wallet.id!==currentWalletId).length<limit;
}
function transactionTeamId(transaction,allTransactions,walletById){
  if(transaction.type==='deposit')return transaction.teamAccountId||walletById.get(transaction.walletId)?.teamId||null;
  if(transaction.type!=='withdrawal')return null;
  if(transaction.teamAccountId)return transaction.teamAccountId;
  const timestamp=new Date(transaction.createdAt||0).getTime();
  const latestDeposit=allTransactions.filter(item=>item.userId===transaction.userId&&item.type==='deposit'&&item.status==='approved'&&new Date(item.createdAt||0).getTime()<=timestamp).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  return latestDeposit?.walletId?walletById.get(latestDeposit.walletId)?.teamId||null:null;
}
async function teamOwnsTransaction(teamId,transaction,allTransactions){
  if(!teamId||!transaction)return false;
  const wallets=await getWalletAddresses();
  return transactionTeamId(transaction,allTransactions,new Map(wallets.map(wallet=>[wallet.id,wallet])))===teamId;
}
async function saveWalletAddress(wallet){
  if(!pool){const db=readDb();db.walletAddresses=db.walletAddresses||[];const i=db.walletAddresses.findIndex(x=>x.id===wallet.id);if(i>=0)db.walletAddresses[i]={...db.walletAddresses[i],...wallet};else db.walletAddresses.unshift(wallet);writeDb(db);return wallet;}
  await pool.query('INSERT INTO wallet_addresses (id,network,address,label,active,team_id,created_by,created_at,updated_at,min_deposit_amount,max_deposit_amount,min_deposit_owner_set,max_deposit_owner_set) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO UPDATE SET network=EXCLUDED.network,address=EXCLUDED.address,label=EXCLUDED.label,active=EXCLUDED.active,team_id=EXCLUDED.team_id,updated_at=EXCLUDED.updated_at,min_deposit_amount=EXCLUDED.min_deposit_amount,max_deposit_amount=EXCLUDED.max_deposit_amount,min_deposit_owner_set=EXCLUDED.min_deposit_owner_set,max_deposit_owner_set=EXCLUDED.max_deposit_owner_set',[wallet.id,wallet.network,wallet.address,wallet.label,wallet.active,wallet.teamId||null,wallet.createdBy,wallet.createdAt,wallet.updatedAt,wallet.minDepositAmount??null,wallet.maxDepositAmount??null,!!wallet.minDepositOwnerSet,!!wallet.maxDepositOwnerSet]);
  return wallet;
}
async function getDepositIntent(id,userId){
  if(!pool)return (readDb().depositIntents||[]).find(x=>x.id===id&&x.userId===userId)||null;
  const r=await pool.query('SELECT id,user_id AS "userId",wallet_id AS "walletId",amount,network,created_at AS "createdAt",expires_at AS "expiresAt",used_at AS "usedAt" FROM deposit_intents WHERE id=$1 AND user_id=$2',[id,userId]);return r.rows[0]||null;
}
async function getDepositIntents(){
  if(!pool)return readDb().depositIntents||[];
  const r=await pool.query('SELECT id,user_id AS "userId",wallet_id AS "walletId",amount,network,created_at AS "createdAt",expires_at AS "expiresAt",used_at AS "usedAt" FROM deposit_intents');return r.rows;
}
function teamCollateralMetrics(teamId,transactions,wallets,intents=[]){
  const walletById=new Map(wallets.map(wallet=>[wallet.id,wallet]));
  const belongs=tx=>transactionTeamId(tx,transactions,walletById)===teamId;
  const exposureDeposits=transactions.filter(tx=>!tx.isSynthetic&&tx.type==='deposit'&&['approved','pending'].includes(tx.status)&&belongs(tx)).reduce((sum,tx)=>sum+Number(tx.amount||0),0);
  const paidWithdrawals=transactions.filter(tx=>!tx.isSynthetic&&tx.type==='withdrawal'&&tx.status==='approved'&&belongs(tx)).reduce((sum,tx)=>sum+Number(tx.amount||0),0);
  const activeReservations=intents.filter(intent=>!intent.usedAt&&new Date(intent.expiresAt).getTime()>Date.now()&&walletById.get(intent.walletId)?.teamId===teamId).reduce((sum,intent)=>sum+Number(intent.amount||0),0);
  const approvedDeposits=transactions.filter(tx=>!tx.isSynthetic&&tx.type==='deposit'&&tx.status==='approved'&&belongs(tx)).reduce((sum,tx)=>sum+Number(tx.amount||0),0);
  return {collateralExposure:Math.max(0,exposureDeposits-paidWithdrawals+activeReservations),commissionEarned:approvedDeposits};
}
async function getTeamMetrics(accounts){
  const [transactions,wallets,intents]=await Promise.all([getTransactions(),getWalletAddresses(),getDepositIntents()]);
  return new Map(accounts.map(account=>[account.id,teamCollateralMetrics(account.id,transactions,wallets,intents)]));
}
async function getTeamCollateralExposure(client,teamId){
  const result=await client.query(`WITH assigned AS (
    SELECT t.type,t.status,t.amount,
      CASE WHEN t.type='deposit' THEN COALESCE(t.team_account_id,w.team_id)
           WHEN t.type='withdrawal' THEN COALESCE(t.team_account_id,(
             SELECT wd.team_id FROM transactions d JOIN wallet_addresses wd ON wd.id=d.wallet_id
             WHERE d.user_id=t.user_id AND d.type='deposit' AND d.status='approved' AND d.is_synthetic=FALSE AND d.created_at<=t.created_at
             ORDER BY d.created_at DESC LIMIT 1))
           ELSE NULL END AS team_id
    FROM transactions t LEFT JOIN wallet_addresses w ON w.id=t.wallet_id
    WHERE t.is_synthetic=FALSE
  )
  SELECT GREATEST(0,
    COALESCE(SUM(amount) FILTER (WHERE type='deposit' AND status IN ('approved','pending') AND team_id=$1),0)
    - COALESCE(SUM(amount) FILTER (WHERE type='withdrawal' AND status='approved' AND team_id=$1),0)
    + COALESCE((SELECT SUM(di.amount) FROM deposit_intents di JOIN wallet_addresses wi ON wi.id=di.wallet_id WHERE wi.team_id=$1 AND di.used_at IS NULL AND di.expires_at>NOW()),0)
  ) AS exposure FROM assigned`,[teamId]);
  return Number(result.rows[0]?.exposure||0);
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
async function requestCooldownRemaining(userId,type){
  const limits=await getRequestLimits(),duration=Number(limits[type==='deposit'?'depositCooldownSeconds':'withdrawalCooldownSeconds']||0)*1000;
  if(!duration)return 0;
  const key=String(userId)+':'+type,mem=Number(requestCooldowns.get(key)||0);
  const now=Date.now();
  if(mem>now)return mem-now;
  const txs=await getTransactions();
  const latest=txs.filter(x=>x.userId===userId && !x.isSynthetic && x.type===type && x.createdAt).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  if(!latest)return 0;
  return Math.max(0,duration-(now-new Date(latest.createdAt).getTime()));
}
async function startRequestCooldown(userId,type){const limits=await getRequestLimits(),duration=Number(limits[type==='deposit'?'depositCooldownSeconds':'withdrawalCooldownSeconds']||0)*1000;if(duration)requestCooldowns.set(String(userId)+':'+type,Date.now()+duration);}

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
  if(req.url==='/api/health' && req.method==='GET') return json(res,200,{ok:true,service:'safepays-api',version:'35.1.0'});
  if(req.url==='/api/public/stats' && req.method==='GET')return json(res,200,await getPublicStats(),{'Cache-Control':'public, max-age=30'});
  if(new URL(req.url,'http://localhost').pathname==='/api/telegram/webhook'&&req.method==='POST'){
    const config=await getSupportTelegramConfig();
    if(!config.botToken||!config.webhookSecret||req.headers['x-telegram-bot-api-secret-token']!==config.webhookSecret)return json(res,404,{ok:false});
    const update=await body(req,1e6),message=update.message||update.edited_message;
    const allowedChatIds=(config.chatIds||[]).map(String);
    if(!message?.chat?.id||!allowedChatIds.includes(String(message.chat.id)))return json(res,404,{ok:false});
    const text=String(message.text||'').trim();
    const reply=text.match(/^\/reply(?:@\w+)?\s+(SUP-[A-Z0-9]+)\s+([\s\S]{1,4000})$/i);
    if(reply){
      const ticketId=reply[1].toUpperCase(),answer=reply[2].trim();let ticket=null;
      if(pool){const t=await pool.query("SELECT id,user_id AS \"userId\",subject,status FROM support_tickets WHERE id=$1 AND status<>'closed'",[ticketId]);ticket=t.rows[0]||null;}
      else ticket=(readDb().supportTickets||[]).find(item=>item.id===ticketId&&item.status!=='closed')||null;
      if(!ticket){await telegramCall(config.botToken,'sendMessage',{chat_id:message.chat.id,text:`${ticketId} bulunamadı veya kapatılmış.`});return json(res,200,{ok:true});}
      const sender=message.from?.username?`Telegram · @${message.from.username}`:`Telegram · ${message.from?.first_name||'Destek ekibi'}`;
      const item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId,senderRole:'admin',senderId:sender,message:answer,attachments:[],createdAt:new Date().toISOString()};
      if(pool){await pool.query('INSERT INTO support_messages (id,ticket_id,sender_role,sender_id,message,attachments,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',[item.id,ticketId,item.senderRole,item.senderId,item.message,'[]',item.createdAt]);await pool.query("UPDATE support_tickets SET status='open',updated_at=$1 WHERE id=$2",[item.createdAt,ticketId]);}
      else{const db=readDb();db.supportMessages=db.supportMessages||[];db.supportMessages.push(item);const row=(db.supportTickets||[]).find(x=>x.id===ticketId);if(row){row.status='open';row.updatedAt=item.createdAt;}writeDb(db);}
      await telegramCall(config.botToken,'sendMessage',{chat_id:message.chat.id,text:`Yanıt ${ticketId} konuşmasına eklendi.`});
    }
    return json(res,200,{ok:true});
  }
  await refreshTransactionExpiry();
  if(req.url==='/api/system/maintenance' && req.method==='GET') return json(res,200,{maintenance:await getMaintenance()});
  if(req.url==='/api/content' && req.method==='GET')return json(res,200,{items:(await getPublishedContent()).filter(x=>x.published)});

  if(req.url==='/api/owner/login' && req.method==='POST'){
    const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),code=String(b.code||'').trim();
    if(!ADMIN_EMAIL||!ADMIN_PASSWORD||!ADMIN_TOTP_SECRET)return json(res,503,{error:'owner_login_not_configured'});
    if(email!==ADMIN_EMAIL.toLowerCase()||password!==ADMIN_PASSWORD){addAudit('owner_login_failed',email||'unknown',{...requestAuditMeta(req),reason:'invalid_credentials'});return json(res,401,{error:'invalid_owner_credentials'});}
    if(!/^\d{6}$/.test(code)||!verifyTotp(ADMIN_TOTP_SECRET,code)){addAudit('owner_login_failed',email,{...requestAuditMeta(req),reason:'invalid_2fa'});return json(res,401,{error:'invalid_2fa_code'});}
    await clearOwnerSessions();
    const t=token(),session={ownerId:'OWNER-001',email:ADMIN_EMAIL,role:'owner',expires:Date.now()+STAFF_TTL};await saveStaffSession(t,'owner',session);
    addAudit('owner_login',ADMIN_EMAIL,requestAuditMeta(req));
    return json(res,200,{ok:true,owner:{id:'OWNER-001',email:ADMIN_EMAIL,role:'owner'},expiresIn:STAFF_SESSION_TTL_SECONDS},{'Set-Cookie':sessionCookie(OWNER_COOKIE,t,STAFF_TTL)});
  }
  if(req.url==='/api/admin/login' && req.method==='POST'){
    const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),code=String(b.code||'').trim();
    const account=(await getTeamAccounts()).find(item=>item.email.toLowerCase()===email);
    if(!account)return json(res,503,{error:'team_login_not_configured'});
    if(!verifyPassword(password,account.passwordHash)){addAudit('team_login_failed',email||'unknown',{...requestAuditMeta(req),reason:'invalid_credentials'});return json(res,401,{error:'invalid_team_credentials'});}
    const credentialsOverlap=account.email.toLowerCase()===ADMIN_EMAIL.toLowerCase()||(ADMIN_PASSWORD&&verifyPassword(ADMIN_PASSWORD,account.passwordHash))||(account.totpSecret&&account.totpSecret===ADMIN_TOTP_SECRET);
    if(credentialsOverlap)return json(res,503,{error:'team_credentials_not_separate'});
    if(account.totpSecret&&!account.twoFactorEnabled)return json(res,403,{error:'team_2fa_setup_pending',message:'Ekip hesabının 2FA kurulumu tamamlanmamış. Owner ile iletişime geçin.'});
    if(account.twoFactorEnabled&&(!/^\d{6}$/.test(code)||!account.totpSecret||!verifyTotp(account.totpSecret,code))){addAudit('team_login_failed',email,{...requestAuditMeta(req),reason:'invalid_2fa'});return json(res,401,{error:'invalid_2fa_code'});}
    await clearTeamSessions(account.id);
    const t=token(),session={adminId:account.id,email:account.email,role:'team_admin',active:account.active!==false,permissions:cleanTeamPermissions(account.permissions),expires:Date.now()+STAFF_TTL};await saveStaffSession(t,'admin',session);
    addAudit('team_admin_login',account.email,requestAuditMeta(req));
    return json(res,200,{ok:true,admin:{id:account.id,email:account.email,role:'team_admin',permissions:cleanTeamPermissions(account.permissions)},expiresIn:STAFF_SESSION_TTL_SECONDS},{'Set-Cookie':sessionCookie(ADMIN_COOKIE,t,STAFF_TTL)});
  }
  if(req.url==='/api/admin/logout' && req.method==='POST'){
    const c=parseCookies(req)[ADMIN_COOKIE]||'';if(c)await deleteStaffSession(c,'admin');return json(res,200,{ok:true},{'Set-Cookie':clearCookie(ADMIN_COOKIE)});
  }
  if(req.url==='/api/owner/logout' && req.method==='POST'){
    const c=parseCookies(req)[OWNER_COOKIE]||'';if(c)await deleteStaffSession(c,'owner');return json(res,200,{ok:true},{'Set-Cookie':clearCookie(OWNER_COOKIE)});
  }
  const owner=await ownerAuth(req),teamAdmin=await adminAuth(req);
  const telegramUrl=new URL(req.url,'http://localhost');
  if(telegramUrl.pathname==='/api/owner/support/telegram'&&['GET','POST'].includes(req.method)){
    if(!owner)return json(res,teamAdmin?403:401,{error:teamAdmin?'owner_only':'unauthorized'});
    if(req.method==='GET'){const config=await getSupportTelegramConfig();return json(res,200,{telegram:publicSupportTelegramConfig(config)});}
    const b=await body(req),current=await getSupportTelegramConfig(),candidate=String(b.botToken||'').trim()||current.botToken||'';
    const chatIds=[...new Set(String(b.chatIds||'').split(/[\\s,;]+/).map(x=>x.trim()).filter(x=>/^-?\d{4,20}$/.test(x)))];
    if(candidate&&!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(candidate))return json(res,400,{error:'invalid_telegram_bot_token',message:'Telegram bot token biçimi geçersiz.'});
    if(candidate&&chatIds.length===0)return json(res,400,{error:'telegram_chat_id_required',message:'En az bir Telegram grup veya hesap Chat ID’si girin.'});
    const config={botToken:candidate,chatIds,webhookSecret:candidate?(current.webhookSecret||crypto.randomBytes(24).toString('hex')):'',updatedAt:new Date().toISOString()};
    await saveSupportTelegramConfig(config);let webhook={configured:false};
    if(candidate){
      try{const origin=process.env.PUBLIC_BASE_URL||`${req.headers['x-forwarded-proto']||'https'}://${req.headers['x-forwarded-host']||req.headers.host}`;await telegramCall(candidate,'setWebhook',{url:`${origin.replace(/\/$/,'')}/api/telegram/webhook`,secret_token:config.webhookSecret,allowed_updates:['message']});webhook={configured:true};}
      catch(error){console.error('Telegram webhook setup failed:',error.message);webhook={configured:false,error:'Telegram webhook kurulamadı. PUBLIC_BASE_URL ve bot erişimini kontrol edin.'};}
    }
    addAudit('support_telegram_updated',owner.email,{configured:!!candidate,chatCount:chatIds.length,webhookConfigured:webhook.configured});
    return json(res,200,{ok:true,telegram:publicSupportTelegramConfig(config),webhook});
  }
  const staticPath=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&staticPath.endsWith('.html')){
    if(staticPath.startsWith('/owner/')){
      if(owner&&staticPath==='/owner/login.html')return redirect(res,'/owner/dashboard.html');
      if(!owner&&staticPath!=='/owner/login.html')return redirect(res,'/owner/login.html?session=owner');
      if(owner&&staticPath==='/owner/withdrawal-pool.html'){
        const runId=new URL(req.url,'http://localhost').searchParams.get('testRunId');
        const params=new URLSearchParams({type:'withdrawal'});
        if(runId)params.set('testRunId',runId);
        return redirect(res,`/owner/requests.html?${params.toString()}`);
      }
    }
    if(staticPath.startsWith('/admin/')){
      if(teamAdmin&&staticPath==='/admin/dashboard.html')return redirect(res,'/admin/team-dashboard.html');
      if(teamAdmin&&staticPath==='/admin/login.html')return redirect(res,'/admin/team-dashboard.html');
      if(!teamAdmin&&staticPath!=='/admin/login.html')return redirect(res,'/admin/login.html?session=team');
      if(teamAdmin&&/^\/admin\/(?:users?|members?|user-center|user-detail|audit)\.html$/.test(staticPath))return redirect(res,'/admin/team-dashboard.html?access=denied');
      if(teamAdmin){
        if(staticPath==='/admin/support.html')return redirect(res,'/admin/team-dashboard.html?access=denied');
        const pagePermission={
          '/admin/requests.html':'transactions','/admin/withdrawal-pool.html':'transactions','/admin/history.html':'transactions',
          '/admin/reports.html':'reports','/admin/reconciliation.html':'reports','/admin/wallet-addresses.html':'wallets','/admin/support.html':'support'
        }[staticPath];
        if(pagePermission&&!teamAdmin.permissions?.[pagePermission])return redirect(res,'/admin/team-dashboard.html?access=denied');
        if(!pagePermission&&!['/admin/login.html','/admin/team-dashboard.html','/admin/dashboard.html','/admin/profile.html','/admin/settings.html'].includes(staticPath))return redirect(res,'/admin/team-dashboard.html?access=denied');
      }
      if(teamAdmin&&staticPath==='/admin/withdrawal-pool.html'){
        return redirect(res,'/admin/requests.html?type=withdrawal');
      }
    }
    return sendFile(req,res);
  }
  if(req.url==='/api/owner/me' && req.method==='GET'){
    if(!owner)return json(res,teamAdmin?403:401,{error:teamAdmin?'owner_only':'unauthorized'});return json(res,200,{owner:{id:owner.ownerId,email:owner.email,role:owner.role}},{'Set-Cookie':sessionCookie(OWNER_COOKIE,parseCookies(req)[OWNER_COOKIE],STAFF_TTL)});
  }
  if(req.url==='/api/owner/team-accounts' && req.method==='GET'){
    if(!owner)return json(res,teamAdmin?403:401,{error:teamAdmin?'owner_only':'unauthorized'});
    const accounts=await getTeamAccounts();
    const metrics=await getTeamMetrics(accounts);
    return json(res,200,{accounts:accounts.map(account=>publicTeamAccount(account,metrics.get(account.id))),configured:accounts.length>0});
  }
  if(req.url==='/api/admin/team/self-disable'&&req.method==='POST'){
    if(!teamAdmin)return json(res,owner?403:401,{error:owner?'team_admin_only':'unauthorized'});
    const accounts=await getTeamAccounts(),account=accounts.find(item=>item.id===teamAdmin.adminId);
    if(!account)return json(res,404,{error:'team_account_not_found'});
    if(!account.allowSelfDisable)return json(res,403,{error:'self_disable_not_allowed'});
    const b=await body(req),requestedPause=typeof b.depositsPaused==='boolean'?b.depositsPaused:!account.depositsPaused;
    const now=new Date().toISOString();
    if(pool){
      const updated=await pool.query('UPDATE team_accounts SET deposits_paused=$1,updated_at=$2 WHERE id=$3 AND allow_self_disable=TRUE AND ($1=TRUE OR active=TRUE) RETURNING active,deposits_paused AS "depositsPaused"',[requestedPause,now,account.id]);
      if(!updated.rows[0]){
        const current=await pool.query('SELECT active,allow_self_disable AS "allowSelfDisable" FROM team_accounts WHERE id=$1',[account.id]);
        if(!current.rows[0])return json(res,404,{error:'team_account_not_found'});
        if(!current.rows[0].allowSelfDisable)return json(res,403,{error:'self_disable_not_allowed',message:'Yatırım alımını değiştirme izniniz kapalı. Lütfen yöneticinizle iletişime geçin.'});
        return json(res,403,{error:'team_deposit_activation_owner_required',message:'Owner hesabı pasife aldı. Yatırım alımını yeniden açmak için lütfen yöneticinizle iletişime geçin.'});
      }
      account.active=updated.rows[0].active;account.depositsPaused=updated.rows[0].depositsPaused;account.updatedAt=now;
    }else{
      if(!requestedPause&&account.active===false)return json(res,403,{error:'team_deposit_activation_owner_required',message:'Owner hesabı pasife aldı. Yatırım alımını yeniden açmak için lütfen yöneticinizle iletişime geçin.'});
      account.depositsPaused=requestedPause;account.updatedAt=now;await saveTeamAccount(account);
    }
    addAudit(account.depositsPaused?'team_deposit_routing_paused':'team_deposit_routing_resumed',account.email,{teamAccountId:account.id});
    return json(res,200,{ok:true,depositsPaused:!!account.depositsPaused,active:account.active!==false});
  }
  if(req.url==='/api/admin/me' && req.method==='GET'){
    if(!teamAdmin)return json(res,owner?403:401,{error:owner?'team_admin_only':'unauthorized'});const settings=(await getTeamAccounts()).find(account=>account.id===teamAdmin.adminId);const metrics=settings?await getTeamMetrics([settings]):new Map();const exposure=Number(metrics.get(teamAdmin.adminId)?.collateralExposure||0),collateralTotal=Number(settings?.collateralTotal||0),commissionPercent=Number(settings?.commissionPercent??3),collateralAutoPause=!!settings?.collateralAutoPause,collateralPausePercent=Number(settings?.collateralPausePercent||80),atPauseThreshold=collateralTotal>0&&exposure>=collateralTotal*(collateralAutoPause?collateralPausePercent:100)/100,collateralPaused=!!settings?.collateralPaused||atPauseThreshold,depositsPaused=!!settings?.depositsPaused,active=settings?.active!==false;return json(res,200,{admin:{id:teamAdmin.adminId,email:teamAdmin.email,role:teamAdmin.role,active,depositsPaused,acceptingDeposits:active&&!depositsPaused&&!collateralPaused,permissions:cleanTeamPermissions(teamAdmin.permissions),allowSelfDisable:!!settings?.allowSelfDisable,collateralBalance:Number(settings?.collateralBalance||0),collateralTotal,collateralExposure:exposure,collateralAvailable:Math.max(0,collateralTotal-exposure),commissionPercent,commissionEarned:Number(metrics.get(teamAdmin.adminId)?.commissionEarned||0)*commissionPercent/100,collateralAutoPause,collateralPausePercent,collateralPaused}},{'Set-Cookie':sessionCookie(ADMIN_COOKIE,parseCookies(req)[ADMIN_COOKIE],STAFF_TTL)});
  }
  const requestedApiPath=new URL(req.url,'http://localhost').pathname;
  const ownerApiRequest=requestedApiPath==='/api/owner'||requestedApiPath.startsWith('/api/owner/');
  const teamApiRequest=requestedApiPath==='/api/admin'||requestedApiPath.startsWith('/api/admin/');
  if(ownerApiRequest&&!owner)return json(res,teamAdmin?403:401,{error:teamAdmin?'owner_only':'owner_unauthorized'});
  if(teamApiRequest&&!teamAdmin)return json(res,owner?403:401,{error:owner?'team_admin_only':'team_admin_unauthorized'});
  if(ownerApiRequest)req.url=req.url.replace(/^\/api\/owner(?=\/|$)/,'/api/admin');
  const admin=ownerApiRequest?owner:teamAdmin;
  if(new URL(req.url,'http://localhost').pathname==='/api/admin/public-stats-display'&&['GET','POST'].includes(req.method)){
    if(!owner)return json(res,teamAdmin?403:401,{error:teamAdmin?'owner_only':'unauthorized'});
    if(req.method==='GET')return json(res,200,{settings:await getPublicStatsDisplay()});
    try{const settings=await savePublicStatsDisplay(await body(req));addAudit('public_stats_display_updated',owner.email,{enabled:settings.enabled,intervalSeconds:settings.intervalSeconds});return json(res,200,{ok:true,settings});}
    catch(error){return json(res,400,{error:'invalid_public_stats_display',message:error.message});}
  }
  const adminPath=new URL(req.url,'http://localhost').pathname;
  const adminQuery=new URL(req.url,'http://localhost');
  const requestedTestRunId=String(adminQuery.searchParams.get('testRunId')||'').trim()||null;
  if(requestedTestRunId&&!owner)return json(res,403,{error:'owner_only'});
  const requestedTestRun=requestedTestRunId?await getSyntheticFinanceRun(requestedTestRunId):null;
  if(requestedTestRunId&&!requestedTestRun)return json(res,404,{error:'synthetic_run_not_found'});
  const ownerOnlyAdminRequest=adminPath==='/api/admin/content'||adminPath==='/api/admin/maintenance'||adminPath==='/api/admin/request-limits'||adminPath.startsWith('/api/admin/synthetic-finance')||adminPath.startsWith('/api/admin/team-accounts')||adminPath.startsWith('/api/admin/audit')||adminPath.startsWith('/api/admin/user-center')||adminPath.startsWith('/api/admin/user/')||adminPath.startsWith('/api/admin/kyc')||(adminPath==='/api/admin/rates'&&req.method==='POST');
  if(teamAdmin&&!owner&&ownerOnlyAdminRequest)return json(res,403,{error:'owner_only'});
  if(teamAdmin&&!owner){const permission=teamPermissionForPath(adminPath);if(!teamAdmin.permissions?.[permission])return json(res,403,{error:'team_permission_denied',permission});}
  if(req.url==='/api/admin/verify-2fa' && req.method==='POST'){if(!admin)return json(res,401,{error:'unauthorized'});const b=await body(req),code=String(b.code||'').trim(),teamAccount=teamAdmin? (await getTeamAccounts()).find(account=>account.id===teamAdmin.adminId):null,secret=owner?ADMIN_TOTP_SECRET:teamAccount?.totpSecret,valid=!!secret&&verifyTotp(secret,code);if(!/^\d{6}$/.test(code)||!valid)return json(res,401,{error:'invalid_2fa_code'});addAudit('admin_sensitive_change_verified',admin.email,{role:admin.role});return json(res,200,{ok:true})}
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
  if(req.url==='/api/admin/request-limits'&&req.method==='GET')return json(res,200,{limits:await getRequestLimits()});
  if(req.url==='/api/admin/request-limits'&&req.method==='POST'){
    if(!owner)return json(res,403,{error:'owner_only'});
    try{const limits=await saveRequestLimits(await body(req));addAudit('request_limits_updated',admin.email,{limits});return json(res,200,{ok:true,limits});}
    catch(error){return json(res,400,{error:'invalid_request_limits',message:error.message});}
  }
  const adminUrl=new URL(req.url,'http://localhost');
  if(adminUrl.pathname==='/api/admin/team-accounts'&&req.method==='POST'){
    if(!owner)return json(res,403,{error:'owner_only'});
    const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');
    if(!/^\d{6}$/.test(String(b.ownerTotpCode||''))||!ADMIN_TOTP_SECRET||!verifyTotp(ADMIN_TOTP_SECRET,String(b.ownerTotpCode)))return json(res,401,{error:'invalid_2fa_code'});
    if(!validEmail(email)||email===ADMIN_EMAIL.toLowerCase()||password.length<12||password===ADMIN_PASSWORD)return json(res,400,{error:'invalid_team_account'});
    const controls=readTeamControls(b,{},true);if(!controls)return json(res,400,{error:'invalid_team_settings',message:'Cüzdan sınırı, teminat ve otomatik duraklatma değerlerini kontrol edin.'});
    const accounts=await getTeamAccounts();if(accounts.some(account=>account.email.toLowerCase()===email))return json(res,409,{error:'team_email_in_use'});
    const suppliedSecret=String(b.totpSecret||'').replace(/[\s-]/g,'').replace(/=+$/,'').toUpperCase();
    if(suppliedSecret&&!/^[A-Z2-7]{16,64}$/.test(suppliedSecret))return json(res,400,{error:'invalid_team_totp_secret',message:'2FA anahtarı 16–64 karakter uzunluğunda Base32 olmalı (A–Z ve 2–7).'});
    const now=new Date().toISOString(),secret=suppliedSecret||base32Encode(crypto.randomBytes(20)),account={id:`TEAM-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,email,passwordHash:hashPassword(password),totpSecret:secret,twoFactorEnabled:false,active:true,depositsPaused:false,permissions:cleanTeamPermissions(b.permissions||DEFAULT_TEAM_PERMISSIONS),...controls,collateralPaused:false,createdAt:now,updatedAt:now};
    await saveTeamAccount(account);addAudit('team_account_created',admin.email,{teamAccountId:account.id,email:account.email});
    const label=encodeURIComponent(`SafePays:${account.email}`),issuer=encodeURIComponent('SafePays');
    return json(res,201,{ok:true,account:publicTeamAccount(account),twoFactorSetup:{secret,otpauthUrl:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`}});
  }
  const teamAccountMatch=adminUrl.pathname.match(/^\/api\/admin\/team-accounts\/([^/]+)$/);
  if(teamAccountMatch&&req.method==='POST'){
    if(!owner)return json(res,403,{error:'owner_only'});
    const id=decodeURIComponent(teamAccountMatch[1]),b=await body(req),ownerCode=String(b.ownerTotpCode||''),action=String(b.action||'update');
    if(!/^\d{6}$/.test(ownerCode)||!ADMIN_TOTP_SECRET||!verifyTotp(ADMIN_TOTP_SECRET,ownerCode))return json(res,401,{error:'invalid_2fa_code'});
    const accounts=await getTeamAccounts(),index=accounts.findIndex(account=>account.id===id);if(index<0)return json(res,404,{error:'team_account_not_found'});
    const account={...accounts[index]},now=new Date().toISOString();
    if(action==='set_chain_verification'){
      if(typeof b.enabled!=='boolean')return json(res,400,{error:'invalid_chain_verification_setting'});
      const previousRequired=account.requireChainVerification!==false;account.requireChainVerification=b.enabled;account.updatedAt=now;await saveTeamAccount(account);
      addAudit('team_chain_verification_policy_updated',admin.email,{teamAccountId:id,teamEmail:account.email,previousRequired,required:account.requireChainVerification});
      return json(res,200,{ok:true,account:publicTeamAccount(account)});
    }
    if(action==='begin_2fa'){
      account.totpSecret=base32Encode(crypto.randomBytes(20));account.twoFactorEnabled=false;account.updatedAt=now;await saveTeamAccount(account);await clearTeamSessions(id);
      const label=encodeURIComponent(`SafePays:${account.email}`),issuer=encodeURIComponent('SafePays');
      return json(res,200,{ok:true,account:publicTeamAccount(account),secret:account.totpSecret,otpauthUrl:`otpauth://totp/${label}?secret=${account.totpSecret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`});
    }
    if(action==='verify_2fa'){
      const code=String(b.teamTotpCode||'');if(!account.totpSecret||!/^\d{6}$/.test(code)||!verifyTotp(account.totpSecret,code))return json(res,400,{error:'invalid_team_2fa_code'});
      account.twoFactorEnabled=true;account.updatedAt=now;await saveTeamAccount(account);await clearTeamSessions(id);addAudit('team_account_2fa_enabled',admin.email,{teamAccountId:id});
      return json(res,200,{ok:true,account:publicTeamAccount(account)});
    }
    if(action==='disable_2fa'){
      account.twoFactorEnabled=false;account.totpSecret=null;account.updatedAt=now;await saveTeamAccount(account);await clearTeamSessions(id);addAudit('team_account_2fa_disabled',admin.email,{teamAccountId:id});
      return json(res,200,{ok:true,account:publicTeamAccount(account)});
    }
    if(action!=='update')return json(res,400,{error:'unknown_team_account_action'});
    if(b.email!==undefined){const email=String(b.email||'').trim().toLowerCase();if(!validEmail(email)||email===ADMIN_EMAIL.toLowerCase())return json(res,400,{error:'invalid_team_email'});if(accounts.some(item=>item.id!==id&&item.email.toLowerCase()===email))return json(res,409,{error:'team_email_in_use'});account.email=email;}
    if(b.password!==undefined&&String(b.password)){const password=String(b.password);if(password.length<12||password===ADMIN_PASSWORD)return json(res,400,{error:'invalid_team_password'});account.passwordHash=hashPassword(password);}
    const wasCollateralPaused=!!account.collateralPaused,controls=readTeamControls(b,account);if(!controls)return json(res,400,{error:'invalid_team_settings',message:'Cüzdan sınırı, komisyon, teminat ve otomatik duraklatma değerlerini kontrol edin.'});Object.assign(account,controls);
    if(b.active!==undefined){account.active=!!b.active;if(account.active)account.depositsPaused=false;}
    const teamMetrics=teamCollateralMetrics(id,await getTransactions(),await getWalletAddresses(),await getDepositIntents()),currentExposure=teamMetrics.collateralExposure,threshold=Number(account.collateralTotal||0)*Number(account.collateralPausePercent||80)/100;
    if(Number(account.collateralTotal||0)>0&&currentExposure>Number(account.collateralTotal)+1e-8)return json(res,409,{error:'team_collateral_below_exposure',message:'Teminat tutarı mevcut ekip kullanımından düşük olamaz.'});
    if(account.collateralAutoPause&&account.collateralTotal>0&&currentExposure>=threshold-1e-8)account.collateralPaused=true;
    else if(wasCollateralPaused)account.collateralPaused=false;
    if(b.permissions!==undefined)account.permissions=cleanTeamPermissions(b.permissions);
    account.updatedAt=now;await saveTeamAccount(account);if(b.email!==undefined||!!b.password||b.permissions!==undefined)await clearTeamSessions(id);addAudit('team_account_updated',admin.email,{teamAccountId:id,emailChanged:b.email!==undefined,passwordChanged:!!b.password,active:account.active,depositsPaused:account.depositsPaused,permissions:account.permissions,walletLimit:account.walletLimit,collateralExposure:currentExposure,commissionPercent:account.commissionPercent});
    return json(res,200,{ok:true,account:publicTeamAccount(account,teamMetrics)});
  }
  if(adminUrl.pathname==='/api/admin/synthetic-finance/eligible-users' && req.method==='GET'){
    if(!owner)return json(res,403,{error:'owner_only'});
    const users=await getUsers(),transactions=await getTransactions(),ledger=await getLedger();
    const eligible=users.filter(user=>user.role==='user'&&!user.isSynthetic&&!user.testRunId&&Number(user.balance||0)===0&&Number(user.referralEarnings||0)===0&&!transactions.some(tx=>tx.userId===user.id)&&!ledger.some(entry=>entry.userId===user.id));
    return json(res,200,{enabled:SYNTHETIC_FINANCE_SEED_ENABLED,users:eligible.map(user=>({id:user.id,firstName:user.firstName,lastName:user.lastName,email:user.email,createdAt:user.createdAt,isTestAccount:!!user.isTestAccount}))});
  }
  if(adminUrl.pathname==='/api/admin/synthetic-finance/mark-test-user' && req.method==='POST'){
    if(!owner)return json(res,403,{error:'owner_only'});
    if(!SYNTHETIC_FINANCE_SEED_ENABLED)return json(res,503,{error:'synthetic_seed_disabled',message:'Test hesabı işaretleme için SYNTHETIC_FINANCE_SEED_ENABLED=true ayarı açılmalı.'});
    const b=await body(req),targetUserId=String(b.targetUserId||'').trim(),confirmedEmail=String(b.confirmedEmail||'').trim().toLowerCase(),confirmText=String(b.confirmText||'').trim(),code=String(b.totpCode||'').trim();
    if(!targetUserId||confirmText!==`TEST ${targetUserId}`)return json(res,400,{error:'test_user_confirmation_required'});
    if(!/^\d{6}$/.test(code)||!ADMIN_TOTP_SECRET||!verifyTotp(ADMIN_TOTP_SECRET,code))return json(res,401,{error:'invalid_2fa_code'});
    if(pool){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const result=await client.query('SELECT id,email,role,balance,referral_earnings AS "referralEarnings",is_test_account AS "isTestAccount",is_synthetic AS "isSynthetic",test_run_id AS "testRunId" FROM users WHERE id=$1 FOR UPDATE',[targetUserId]);
        const user=result.rows[0];
        if(!user||user.email.toLowerCase()!==confirmedEmail||user.role!=='user'){await client.query('ROLLBACK');return json(res,404,{error:'test_user_not_found'});}
        if(user.isTestAccount){await client.query('ROLLBACK');return json(res,409,{error:'test_user_already_marked'});}
        if(user.isSynthetic||user.testRunId||Number(user.balance||0)!==0||Number(user.referralEarnings||0)!==0){await client.query('ROLLBACK');return json(res,409,{error:'test_user_not_empty'});}
        const existing=await client.query('SELECT 1 FROM transactions WHERE user_id=$1 LIMIT 1',[targetUserId]);
        if(existing.rows.length){await client.query('ROLLBACK');return json(res,409,{error:'test_user_not_empty'});}
        const existingLedger=await client.query('SELECT 1 FROM ledger_entries WHERE user_id=$1 LIMIT 1',[targetUserId]);
        if(existingLedger.rows.length){await client.query('ROLLBACK');return json(res,409,{error:'test_user_not_empty'});}
        await client.query('UPDATE users SET is_test_account=TRUE WHERE id=$1',[targetUserId]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }else{
      const db=readDb(),user=(db.users||[]).find(item=>String(item.id)===targetUserId);
      if(!user||String(user.email||'').toLowerCase()!==confirmedEmail||user.role!=='user')return json(res,404,{error:'test_user_not_found'});
      if(user.isTestAccount)return json(res,409,{error:'test_user_already_marked'});
      if(user.isSynthetic||user.testRunId||Number(user.balance||0)!==0||Number(user.referralEarnings||0)!==0||(db.transactions||[]).some(tx=>String(tx.userId)===targetUserId)||(db.ledger||[]).some(entry=>String(entry.userId)===targetUserId))return json(res,409,{error:'test_user_not_empty'});
      user.isTestAccount=true;writeDb(db);
    }
    addAudit('synthetic_test_user_marked',admin.email,{targetUserId});
    return json(res,200,{ok:true,targetUserId,isTestAccount:true,productionExcluded:true});
  }
  if(adminUrl.pathname==='/api/admin/synthetic-finance/runs' && req.method==='GET'){
    if(!owner)return json(res,403,{error:'owner_only'});
    if(pool){const result=await pool.query('SELECT r.id,r.target_user_id AS "targetUserId",r.created_at AS "createdAt",r.start_date AS "startDate",r.end_date AS "endDate",r.member_count AS "memberCount",r.transaction_count AS "transactionCount",r.commission_rate AS "commissionRate",u.first_name AS "firstName",u.last_name AS "lastName",u.email FROM synthetic_finance_runs r JOIN users u ON u.id=r.target_user_id ORDER BY r.created_at DESC');return json(res,200,{runs:result.rows});}
    const db=readDb(),runs=(db.syntheticFinanceRuns||[]).map(run=>{const user=(db.users||[]).find(x=>x.id===run.targetUserId)||{};return {...run,firstName:user.firstName,lastName:user.lastName,email:user.email};});
    return json(res,200,{runs:runs.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))});
  }
  if(adminUrl.pathname==='/api/admin/synthetic-finance/seed' && req.method==='POST'){
    if(!owner)return json(res,403,{error:'owner_only'});
    if(!SYNTHETIC_FINANCE_SEED_ENABLED)return json(res,503,{error:'synthetic_seed_disabled',message:'Seed işlemi için SYNTHETIC_FINANCE_SEED_ENABLED=true ayarı açılmalı.'});
    const b=await body(req),targetUserId=String(b.targetUserId||'').trim(),confirmedEmail=String(b.confirmedEmail||'').trim().toLowerCase(),confirmText=String(b.confirmText||'').trim(),code=String(b.totpCode||'').trim();
    if(!targetUserId||confirmText!==`TEST ${targetUserId}`)return json(res,400,{error:'test_user_confirmation_required'});
    if(!/^\d{6}$/.test(code)||!ADMIN_TOTP_SECRET||!verifyTotp(ADMIN_TOTP_SECRET,code))return json(res,401,{error:'invalid_2fa_code'});
    const existingUsers=await getUsers(),initialTarget=existingUsers.find(user=>String(user.id)===targetUserId);
    if(!initialTarget||initialTarget.role!=='user'||String(initialTarget.email||'').toLowerCase()!==confirmedEmail)return json(res,404,{error:'test_user_not_found'});
    if(!initialTarget.isTestAccount)return json(res,409,{error:'test_user_not_marked',message:'Önce hesabı Owner panelinden test kullanıcısı olarak işaretleyin.'});
    if(initialTarget.isSynthetic||initialTarget.testRunId)return json(res,409,{error:'test_user_already_seeded'});
    const allTransactions=await getTransactions();
    if(Number(initialTarget.balance||0)!==0||Number(initialTarget.referralEarnings||0)!==0||allTransactions.some(tx=>String(tx.userId)===targetUserId)||(await getLedger(targetUserId)).length)return json(res,409,{error:'test_user_not_empty',message:'Seçilen test hesabında mevcut bakiye, referans kazancı veya işlem var. Boş test hesabı seçin.'});

    const today=new Date();today.setUTCHours(0,0,0,0);
    const start=new Date(today.getTime()-89*86400000),startDate=utcDateKey(start),endDate=utcDateKey(today);
    const runId=`SYN-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const earliestUserDate=new Date(start.getTime()-86400000).toISOString();
    const rootUser={...initialTarget,isSynthetic:true,testRunId:runId,createdAt:new Date(Math.min(new Date(initialTarget.createdAt||today).getTime(),new Date(earliestUserDate).getTime())).toISOString()};
    const members=makeSyntheticMembers({runId,targetUser:rootUser,startDate,existingUsers});
    const idUsers=[...existingUsers];
    for(const member of members.slice(1)){member.id=makeUserId(idUsers);member.passwordHash=hashPassword(crypto.randomBytes(32).toString('hex'));idUsers.push(member);}
    const transactions=makeSyntheticTransactions({runId,users:members,startDate,days:90});
    if(!transactions.length||transactions.some(item=>Number(item.transaction.amount)<50||!['deposit','withdrawal'].includes(item.transaction.type)))return json(res,500,{error:'synthetic_fixture_invalid'});
    const createdAt=new Date().toISOString();
    const run={id:runId,targetUserId,createdAt,startDate,endDate,memberCount:members.length,transactionCount:transactions.length,commissionRate:SYNTHETIC_TEST_COMMISSION_RATE};
    const actor=`synthetic-fixture:${runId}`;
    if(pool){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const locked=await client.query('SELECT id,email,role,balance,referral_earnings AS "referralEarnings",is_test_account AS "isTestAccount",is_synthetic AS "isSynthetic",test_run_id AS "testRunId" FROM users WHERE id=$1 FOR UPDATE',[targetUserId]);
        const current=locked.rows[0];
        if(!current||current.email.toLowerCase()!==confirmedEmail||current.role!=='user'||!current.isTestAccount||current.isSynthetic||current.testRunId||Number(current.balance||0)!==0||Number(current.referralEarnings||0)!==0){await client.query('ROLLBACK');return json(res,409,{error:'test_user_not_eligible'});}
        const currentTx=await client.query('SELECT 1 FROM transactions WHERE user_id=$1 LIMIT 1',[targetUserId]);
        if(currentTx.rows.length){await client.query('ROLLBACK');return json(res,409,{error:'test_user_not_empty'});}
        const currentLedger=await client.query('SELECT 1 FROM ledger_entries WHERE user_id=$1 LIMIT 1',[targetUserId]);
        if(currentLedger.rows.length){await client.query('ROLLBACK');return json(res,409,{error:'test_user_not_empty'});}
        await client.query('UPDATE users SET is_synthetic=TRUE,test_run_id=$1,created_at=$2 WHERE id=$3',[runId,rootUser.createdAt,targetUserId]);
        for(const member of members.slice(1))await insertUser(member,client);
        await client.query('INSERT INTO synthetic_finance_runs (id,target_user_id,created_at,start_date,end_date,member_count,transaction_count,commission_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[run.id,run.targetUserId,run.createdAt,run.startDate,run.endDate,run.memberCount,run.transactionCount,run.commissionRate]);
        for(const item of transactions){
          await insertTransaction(item.transaction,client);
          if(item.decision)await applyTransactionDecision({tx:item.transaction,decision:item.decision.status,approvedAmount:item.decision.approvedAmount,actor,decisionAt:item.decision.decisionAt,client});
        }
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }else{
      const db=readDb(),target=(db.users||[]).find(user=>String(user.id)===targetUserId);
      if(!target||target.email.toLowerCase()!==confirmedEmail||target.role!=='user'||!target.isTestAccount||target.isSynthetic||target.testRunId||Number(target.balance||0)!==0||Number(target.referralEarnings||0)!==0||(db.transactions||[]).some(tx=>String(tx.userId)===targetUserId)||(db.ledger||[]).some(entry=>String(entry.userId)===targetUserId))return json(res,409,{error:'test_user_not_eligible'});
      Object.assign(target,rootUser);
      db.transactions=db.transactions||[];db.ledger=db.ledger||[];db.syntheticFinanceRuns=db.syntheticFinanceRuns||[];
      db.users.push(...members.slice(1));db.syntheticFinanceRuns.push(run);
      for(const item of transactions){db.transactions.unshift(item.transaction);if(item.decision)await applyTransactionDecision({tx:item.transaction,decision:item.decision.status,approvedAmount:item.decision.approvedAmount,actor,decisionAt:item.decision.decisionAt,dbState:db});}
      writeDb(db);
    }
    addAudit('synthetic_finance_seed',admin.email,{runId,targetUserId,memberCount:members.length,transactionCount:transactions.length,startDate,endDate});
    return json(res,201,{ok:true,run,reportUrl:`/owner/reports.html?testRunId=${encodeURIComponent(runId)}`,reconciliationUrl:`/owner/reconciliation.html?testRunId=${encodeURIComponent(runId)}`});
  }
  if(adminUrl.pathname==='/api/admin/finance/reconciliation' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const testRunId=String(adminUrl.searchParams.get('testRunId')||'').trim()||null;
    if(testRunId&&!owner)return json(res,403,{error:'owner_only'});
    const defaults=defaultFinanceRange();
    const startDate=adminUrl.searchParams.get('startDate')||defaults.startDate,endDate=adminUrl.searchParams.get('endDate')||defaults.endDate;
    if(!validDateKey(startDate)||!validDateKey(endDate)||startDate>endDate)return json(res,400,{error:'invalid_date_range'});
    const span=(new Date(`${endDate}T00:00:00Z`)-new Date(`${startDate}T00:00:00Z`))/86400000+1;
    if(span>366)return json(res,400,{error:'date_range_too_large'});
    const run=testRunId?await getSyntheticFinanceRun(testRunId):null;
    if(testRunId&&!run)return json(res,404,{error:'synthetic_run_not_found'});
    let financeTransactions=await getTransactions(),commissionRate=run?Number(run.commissionRate):0,commissionEnabled=!!run,commissionPercent=commissionRate*100,lifetimeSettlement=null;
    if(teamAdmin&&!owner&&!testRunId){
      const accounts=await getTeamAccounts(),account=accounts.find(item=>item.id===teamAdmin.adminId),wallets=await getWalletAddresses(),walletById=new Map(wallets.map(wallet=>[wallet.id,wallet]));
      financeTransactions=financeTransactions.filter(tx=>transactionTeamId(tx,financeTransactions,walletById)===teamAdmin.adminId);
      commissionPercent=Number(account?.commissionPercent??3);commissionRate=commissionPercent/100;commissionEnabled=!!account;
      lifetimeSettlement=calculateSettlement(financeTransactions,{commissionRate});
    }else if(owner&&!testRunId){
      const accounts=await getTeamAccounts(),wallets=await getWalletAddresses(),walletById=new Map(wallets.map(wallet=>[wallet.id,wallet]));
      const teamByTransaction=new Map(financeTransactions.map(tx=>[tx.id,transactionTeamId(tx,financeTransactions,walletById)]));
      const commissionByTeam=new Map(accounts.map(account=>[account.id,Number(account.commissionPercent??3)]));
      const teamTransactions=financeTransactions.filter(tx=>teamByTransaction.get(tx.id));
      const teamForTransaction=tx=>teamByTransaction.get(tx.id)||null;
      lifetimeSettlement=calculateSettlement(teamTransactions,{commissionByTeam,teamForTransaction});
      commissionEnabled=accounts.length>0;
    }
    const finance=buildFinanceReconciliation(financeTransactions,{startDate,endDate,runId:testRunId,commissionRate,commissionEnabled,commissionPercent});
    if(commissionEnabled&&finance.totals.deposit)finance.commissionPercent=finance.totals.commission/finance.totals.deposit*100;
    return json(res,200,{...finance,lifetimeSettlement:lifetimeSettlement?{...lifetimeSettlement,scope:owner?'teams':'team'}:null,run:run?{id:run.id,targetUserId:run.targetUserId,createdAt:run.createdAt,memberCount:Number(run.memberCount),transactionCount:Number(run.transactionCount)}:null});
  }
  if(adminQuery.pathname==='/api/admin/stats' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const allUsers=await getUsers(),allTx=await getTransactions();
    const users=allUsers.filter(user=>requestedTestRunId?user.testRunId===requestedTestRunId:isProductionUser(user));
    const tx=allTx.filter(item=>requestedTestRunId?item.testRunId===requestedTestRunId:isProductionTransaction(item));
    const sum=(arr)=>arr.reduce((a,x)=>a+Number(x.amount||0),0),stats={pending:tx.filter(x=>x.status==='pending').length,approved:tx.filter(x=>x.status==='approved').length,totalDeposits:sum(tx.filter(x=>x.type==='deposit'&&x.status==='approved')),totalWithdrawals:sum(tx.filter(x=>x.type==='withdrawal'&&x.status==='approved'))};
    if(owner)Object.assign(stats,{users:users.length,kycPending:users.filter(x=>x.kycStatus==='pending').length});
    return json(res,200,stats);
  }
  if(adminQuery.pathname==='/api/admin/users' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    let users=(await getUsers()).filter(user=>requestedTestRunId?user.testRunId===requestedTestRunId:isProductionUser(user));
    if(teamAdmin&&!owner){
      const transactions=(await getTransactions()).filter(item=>isProductionTransaction(item)),wallets=await getWalletAddresses(),walletById=new Map(wallets.map(wallet=>[wallet.id,wallet]));
      const teamUserIds=new Set(transactions.filter(item=>transactionTeamId(item,transactions,walletById)===teamAdmin.adminId).map(item=>item.userId));
      users=users.filter(user=>teamUserIds.has(user.id));
      return json(res,200,{users:users.map(safeTeamMember)});
    }
    return json(res,200,{users:users.map(safeUser)});
  }
  if(req.url.startsWith('/api/admin/user-center') && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const urlObj=new URL(req.url,'http://localhost'); const q=(urlObj.searchParams.get('q')||'').trim().toLowerCase();
    const users=(await getUsers()).filter(user=>requestedTestRunId?user.testRunId===requestedTestRunId:isProductionUser(user)); const tx=(await getTransactions()).filter(item=>requestedTestRunId?item.testRunId===requestedTestRunId:isProductionTransaction(item));
    const filtered=users.filter(u=>!q || [u.id,u.firstName,u.lastName,u.email,u.phone,u.referralCode].filter(Boolean).join(' ').toLowerCase().includes(q));
    const rows=filtered.map(u=>{const ut=tx.filter(x=>x.userId===u.id);return {...safeUser(u), totalDeposits:ut.filter(x=>x.type==='deposit'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0), totalWithdrawals:ut.filter(x=>x.type==='withdrawal'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0), pendingCount:ut.filter(x=>x.status==='pending').length, transactions:ut.length};});
    const kyc=users.filter(u=>u.kycStatus==='pending').map(u=>({userId:u.id,name:u.kycName,email:u.email,submittedAt:u.kycSubmittedAt,status:u.kycStatus}));
    return json(res,200,{users:rows,kycPending:kyc,totalUsers:users.length,pendingKyc:kyc.length});
  }
  if(req.url.startsWith('/api/admin/user/') && !req.url.endsWith('/security') && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const id=decodeURIComponent(req.url.split('?')[0].split('/').pop()); const u=await findUserById(id); if(!u||(!owner&&(u.isSynthetic||u.isTestAccount))||(requestedTestRunId&&u.testRunId!==requestedTestRunId))return json(res,404,{error:'user_not_found'});
    const tx=(await getTransactions()).filter(x=>x.userId===id); const deposits=tx.filter(x=>x.type==='deposit'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0); const withdrawals=tx.filter(x=>x.type==='withdrawal'&&x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0);
    return json(res,200,{user:safeUser(u),summary:{deposits,withdrawals,pending:tx.filter(x=>x.status==='pending').reduce((a,x)=>a+Number(x.amount||0),0),transactions:tx.length},transactions:tx.map(safeTransaction),ledger:(await getLedger(id)).map(safeLedgerEntry)});
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
  if(adminQuery.pathname==='/api/admin/transactions' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const all=await getTransactions();let transactions=all.filter(item=>requestedTestRunId?item.testRunId===requestedTestRunId:isProductionTransaction(item));const wallets=await getWalletAddresses(),walletById=new Map(wallets.map(wallet=>[wallet.id,wallet])),teams=await getTeamAccounts(),chainPolicyByTeam=new Map(teams.map(account=>[account.id,account.requireChainVerification!==false]));if(teamAdmin&&!owner)transactions=transactions.filter(item=>transactionTeamId(item,all,walletById)===teamAdmin.adminId);return json(res,200,{transactions:transactions.map(item=>{const teamId=transactionTeamId(item,all,walletById),safe=item=>owner&&requestedTestRunId?item:safeTransaction(item);return {...safe(item),chainVerificationRequired:teamId?chainPolicyByTeam.get(teamId)!==false:true};})});
  }
  if(req.url==='/api/admin/transactions/verify-chain' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const b=await body(req),id=String(b.transactionId||''),transactions=await getTransactions(),tx=transactions.find(x=>x.id===id);
    if(!tx||teamAdmin&&!owner&&!(await teamOwnsTransaction(teamAdmin.adminId,tx,transactions)))return json(res,404,{error:'transaction_not_found'});
    if(tx.isSynthetic)return json(res,409,{error:'synthetic_transaction_has_no_chain_transfer'});
    if(!['deposit','withdrawal'].includes(tx.type))return json(res,400,{error:'unsupported_transaction_type'});
    const txHash=tx.type==='deposit'?String(tx.txHash||''):String(b.txHash||'').trim();
    const amount=Number(b.amount??tx.amount);
    if(!txHash)return json(res,400,{error:'tx_hash_required'});
    if(!Number.isFinite(amount)||amount<=0)return json(res,400,{error:'invalid_amount'});
    const wallets=await getWalletAddresses(),teamId=transactionTeamId(tx,transactions,new Map(wallets.map(wallet=>[wallet.id,wallet]))),team=teamId?(await getTeamAccounts()).find(account=>account.id===teamId):null,chainVerificationRequired=team?team.requireChainVerification!==false:true;
    const verification=await verifyUsdtTransfer({network:tx.network,txHash,recipient:tx.address,amount});
    addAudit('chain_transfer_check',admin.email,{transactionId:id,network:tx.network,type:tx.type,txHash,status:verification.status,reason:verification.reason,blockNumber:verification.blockNumber||null});
    return json(res,200,{ok:true,verification,chainVerificationRequired,teamAccountId:teamId});
  }
  if(adminQuery.pathname==='/api/admin/ledger' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const userId=adminQuery.searchParams.get('userId')||null; const ledger=await getLedger(userId); return json(res,200,{ledger:ledger.filter(item=>requestedTestRunId?item.testRunId===requestedTestRunId:!item.isSynthetic).map(safeLedgerEntry)});
  }
  if(req.url==='/api/admin/wallet-addresses' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});const all=await getWalletAddresses();return json(res,200,{wallets:teamAdmin&&!owner?all.filter(wallet=>wallet.teamId===teamAdmin.adminId):all});
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
      const teamId=owner?(String(b.teamId||'').trim()||null):(teamAdmin?.adminId||null);
      if(teamId&&!((await getTeamAccounts()).some(account=>account.id===teamId)))return json(res,400,{error:'invalid_team_account'});
      if(teamId&&!(await walletTeamAllowed(teamId)))return json(res,409,{error:'team_wallet_limit_reached',message:'Bu ekibin kayıtlı cüzdan sınırına ulaşıldı.'});
      const minDepositAmount=b.minDepositAmount===''||b.minDepositAmount==null?null:Number(b.minDepositAmount),maxDepositAmount=b.maxDepositAmount===''||b.maxDepositAmount==null?null:Number(b.maxDepositAmount);
      if((minDepositAmount!==null&&(!Number.isFinite(minDepositAmount)||minDepositAmount<0))||(maxDepositAmount!==null&&(!Number.isFinite(maxDepositAmount)||maxDepositAmount<=0))||(minDepositAmount!==null&&maxDepositAmount!==null&&minDepositAmount>maxDepositAmount))return json(res,400,{error:'invalid_deposit_limits',message:'Alt ve üst yatırım sınırlarını kontrol edin; alt sınır üst sınırı geçemez.'});
      const now=new Date().toISOString(),wallet={id:`WLT-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,network,address,label,active:b.active!==false,teamId,createdBy:admin.email,createdAt:now,updatedAt:now,useCount:0,lastUsedAt:null,minDepositAmount,maxDepositAmount,minDepositOwnerSet:!!owner&&minDepositAmount!==null,maxDepositOwnerSet:!!owner&&maxDepositAmount!==null};
      await saveWalletAddress(wallet);addAudit('wallet_address_created',admin.email,{walletId:wallet.id,network,teamId});return json(res,201,{ok:true,wallet});
    }
    const id=String(b.id||''),wallets=await getWalletAddresses(),current=wallets.find(w=>w.id===id);if(!current)return json(res,404,{error:'wallet_not_found'});
    if(teamAdmin&&!owner&&current.teamId!==teamAdmin.adminId)return json(res,404,{error:'wallet_not_found'});
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
      const teamId=owner&&b.teamId!==undefined?(String(b.teamId||'').trim()||null):current.teamId||null;
      if(teamId&&!((await getTeamAccounts()).some(account=>account.id===teamId)))return json(res,400,{error:'invalid_team_account'});
      if(teamId&&!(await walletTeamAllowed(teamId,id)))return json(res,409,{error:'team_wallet_limit_reached',message:'Bu ekibin kayıtlı cüzdan sınırına ulaşıldı.'});
      const parseLimit=(key,value)=>b[key]===undefined?value:(b[key]===''||b[key]===null?null:Number(b[key]));
      const minDepositAmount=parseLimit('minDepositAmount',current.minDepositAmount??null),maxDepositAmount=parseLimit('maxDepositAmount',current.maxDepositAmount??null);
      if((minDepositAmount!==null&&(!Number.isFinite(minDepositAmount)||minDepositAmount<0))||(maxDepositAmount!==null&&(!Number.isFinite(maxDepositAmount)||maxDepositAmount<=0))||(minDepositAmount!==null&&maxDepositAmount!==null&&minDepositAmount>maxDepositAmount))return json(res,400,{error:'invalid_deposit_limits',message:'Alt ve üst yatırım sınırlarını kontrol edin; alt sınır üst sınırı geçemez.'});
      if(teamAdmin&&!owner&&((current.minDepositOwnerSet&&b.minDepositAmount!==undefined&&minDepositAmount!==(current.minDepositAmount??null))||(current.maxDepositOwnerSet&&b.maxDepositAmount!==undefined&&maxDepositAmount!==(current.maxDepositAmount??null))))return json(res,403,{error:'wallet_deposit_limits_owner_managed',message:'Bu cüzdanın yatırım alt/üst sınırlarını Owner belirlemiştir. Lütfen limitlerinizi değiştirmek için yöneticinizle iletişime geçin.'});
      const next={...current,network,address,label,teamId,active:b.active===undefined?current.active:!!b.active,minDepositAmount,maxDepositAmount,minDepositOwnerSet:owner?(b.minDepositAmount===undefined?!!current.minDepositOwnerSet:minDepositAmount!==null):!!current.minDepositOwnerSet,maxDepositOwnerSet:owner?(b.maxDepositAmount===undefined?!!current.maxDepositOwnerSet:maxDepositAmount!==null):!!current.maxDepositOwnerSet,updatedAt:new Date().toISOString()};await saveWalletAddress(next);addAudit('wallet_address_updated',admin.email,{walletId:id,network,active:next.active,teamId,minDepositAmount,maxDepositAmount,minDepositOwnerSet:next.minDepositOwnerSet,maxDepositOwnerSet:next.maxDepositOwnerSet});return json(res,200,{ok:true,wallet:next});
    }
    return json(res,400,{error:'invalid_action'});
  }
  if(new URL(req.url,'http://localhost').pathname==='/api/admin/support/tickets' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    if(teamAdmin&&!owner)return json(res,403,{error:'owner_only',message:'Destek talepleri yalnızca Owner panelinden yönetilir.'});
    if(pool){const r=await pool.query('SELECT t.id,t.user_id AS "userId",t.subject,t.status,t.created_at AS "createdAt",t.updated_at AS "updatedAt",u.email,u.first_name AS "firstName",u.last_name AS "lastName" FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.updated_at DESC');const ids=r.rows.map(x=>x.id);const m=ids.length?await pool.query('SELECT id,ticket_id AS "ticketId",sender_role AS "senderRole",sender_id AS "senderId",message,attachments,created_at AS "createdAt" FROM support_messages WHERE ticket_id=ANY($1::text[]) ORDER BY created_at',[ids]):{rows:[]};const byId=new Map();for(const msg of m.rows){if(!byId.has(msg.ticketId))byId.set(msg.ticketId,[]);byId.get(msg.ticketId).push(msg);}return json(res,200,{tickets:r.rows.map(({email,...ticket})=>({...ticket,...(owner?{email}:{}),messages:byId.get(ticket.id)||[]}))});}
    const db=readDb(),users=db.users||[],messages=db.supportMessages||[];return json(res,200,{tickets:(db.supportTickets||[]).map(t=>{const user=users.find(u=>u.id===t.userId);return {...t,...(user?{user:owner?safeUser(user):safeTeamMember(user)}:{}),messages:messages.filter(m=>m.ticketId===t.id)}}).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))});
  }
  const adminSupportMatch=new URL(req.url,'http://localhost').pathname.match(/^\/api\/admin\/support\/tickets\/([^/]+)\/messages$/);
  if(adminSupportMatch&&req.method==='POST'){
    if(teamAdmin&&!owner)return json(res,403,{error:'owner_only',message:'Destek talepleri yalnızca Owner panelinden yönetilir.'});
    if(!admin)return json(res,401,{error:'unauthorized'});const ticketId=decodeURIComponent(adminSupportMatch[1]),b=await body(req),message=String(b.message||'').trim().slice(0,4000);if(!message)return json(res,400,{error:'empty_message'});
    if(pool){const client=await pool.connect();try{await client.query('BEGIN');const ticket=await client.query("SELECT id,subject,user_id AS \"userId\" FROM support_tickets WHERE id=$1 AND status<>'closed' FOR UPDATE",[ticketId]);if(!ticket.rows[0]){await client.query('ROLLBACK');return json(res,404,{error:'ticket_not_found'});}const item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId,senderRole:'admin',senderId:admin.email,message,attachments:[],createdAt:new Date().toISOString()};await client.query('INSERT INTO support_messages (id,ticket_id,sender_role,sender_id,message,attachments,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',[item.id,ticketId,item.senderRole,item.senderId,item.message,'[]',item.createdAt]);await client.query("UPDATE support_tickets SET status='open',updated_at=$1 WHERE id=$2",[item.createdAt,ticketId]);await client.query('COMMIT');addAudit('support_reply',admin.email,{ticketId});await forwardSupportMessageToTelegram({id:ticketId,subject:ticket.rows[0].subject,userId:ticket.rows[0].userId,userName:'Owner'},item);return json(res,201,{ok:true,message:item});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
    const db=readDb(),ticket=(db.supportTickets||[]).find(x=>x.id===ticketId&&x.status!=='closed');if(!ticket)return json(res,404,{error:'ticket_not_found'});const item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId,senderRole:'admin',senderId:admin.email,message,attachments:[],createdAt:new Date().toISOString()};db.supportMessages=db.supportMessages||[];db.supportMessages.push(item);ticket.status='open';ticket.updatedAt=item.createdAt;writeDb(db);addAudit('support_reply',admin.email,{ticketId});await forwardSupportMessageToTelegram({...ticket,userName:'Owner'},item);return json(res,201,{ok:true,message:item});
  }
  if(req.url==='/api/admin/kyc' && req.method==='GET'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const users=await getUsers(); return json(res,200,{requests:users.filter(u=>isProductionUser(u)&&u.kycStatus==='pending').map(u=>({userId:u.id,name:u.kycName,email:u.email,submittedAt:u.kycSubmittedAt,status:u.kycStatus}))});
  }
  if(req.url==='/api/admin/kyc/decision' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const b=await body(req); const id=String(b.userId||''); const decision=['approved','rejected'].includes(b.decision)?b.decision:null; if(!decision)return json(res,400,{error:'invalid_decision'});
    if(pool)await pool.query('UPDATE users SET kyc_status=$1 WHERE id=$2',[decision,id]); else{const db=readDb();const u=db.users.find(x=>x.id===id);if(!u)return json(res,404,{error:'user_not_found'});u.kycStatus=decision;writeDb(db);} addAudit('kyc_decision',admin.email,{userId:id,decision}); return json(res,200,{ok:true,status:decision});
  }
  if(req.url==='/api/admin/transactions/lock' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const b=await body(req); const id=String(b.transactionId||''); const all=await getTransactions(); const tx=all.find(x=>x.id===id); if(!tx||teamAdmin&&!owner&&!(await teamOwnsTransaction(teamAdmin.adminId,tx,all)))return json(res,404,{error:'transaction_not_found'}); if(tx.isSynthetic&&!owner)return json(res,404,{error:'transaction_not_found'}); if(tx.status!=='pending')return json(res,409,{error:'not_pending',status:tx.status});
    if(isLocked(tx) && tx.lockedBy!==admin.email)return json(res,409,{error:'transaction_locked',lockedBy:tx.lockedBy});
    const now=new Date().toISOString(); if(pool) await pool.query('UPDATE transactions SET locked_by=$1, locked_at=$2 WHERE id=$3',[admin.email,now,id]); else {const db=readDb();const row=db.transactions.find(x=>x.id===id);row.lockedBy=admin.email;row.lockedAt=now;writeDb(db);} txLocks.set(lockKey(id),admin.email); addAudit('transaction_lock',admin.email,{transactionId:id,lockMinutes:TX_CONTROL.lockMinutes}); return json(res,200,{ok:true,lockedBy:admin.email,lockedAt:now,lockMinutes:TX_CONTROL.lockMinutes});
  }
  if(req.url==='/api/admin/transactions/reopen' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'});
    const b=await body(req),id=String(b.transactionId||''),all=await getTransactions(),tx=all.find(x=>x.id===id);
    if(!tx||teamAdmin&&!owner&&!(await teamOwnsTransaction(teamAdmin.adminId,tx,all)))return json(res,404,{error:'transaction_not_found'});
    if(tx.isSynthetic&&!owner)return json(res,404,{error:'transaction_not_found'});
    if(!['auto-rejected','rejected'].includes(tx.status))return json(res,409,{error:'not_reopenable',status:tx.status});
    const expiresAt=new Date(Date.now()+TX_CONTROL.autoRejectMinutes*60000).toISOString();let reopenTeamId=tx.teamAccountId||null,collateralResult=null;
    if(tx.type==='deposit'&&!reopenTeamId){const wallets=await getWalletAddresses();reopenTeamId=wallets.find(wallet=>wallet.id===tx.walletId)?.teamId||null;}
    if(pool){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');const lock=await client.query('SELECT status FROM transactions WHERE id=$1 FOR UPDATE',[id]);
        if(!lock.rows[0]||!['auto-rejected','rejected'].includes(lock.rows[0].status)){await client.query('ROLLBACK');return json(res,409,{error:'not_reopenable'});}
        if(tx.type==='deposit'&&reopenTeamId){
          const team=await client.query('SELECT collateral_total AS "collateralTotal" FROM team_accounts WHERE id=$1 FOR UPDATE',[reopenTeamId]);
          if(team.rows[0]&&Number(team.rows[0].collateralTotal||0)>0){const exposure=await getTeamCollateralExposure(client,reopenTeamId);if(exposure+Number(tx.requestedAmount??tx.amount)>Number(team.rows[0].collateralTotal)+1e-8){await client.query('ROLLBACK');return json(res,409,{error:'team_collateral_limit_exceeded',message:'Bu yatırım talebi yeniden açıldığında ekip teminat sınırı aşılacak.'});}}
        }
        await client.query("UPDATE transactions SET status='pending',decision_by=NULL,decision_at=NULL,locked_by=NULL,locked_at=NULL,expires_at=$1,team_account_id=COALESCE($2,team_account_id) WHERE id=$3",[expiresAt,reopenTeamId,id]);
        if(tx.type==='deposit'&&reopenTeamId){const exposure=await getTeamCollateralExposure(client,reopenTeamId);collateralResult=await syncTeamCollateral({teamId:reopenTeamId,exposure,client,at:new Date().toISOString()});}
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');if(error.message==='team_collateral_limit_exceeded')return json(res,409,{error:'team_collateral_limit_exceeded',message:'Bu yatırım talebi yeniden açıldığında ekip teminat sınırı aşılacak.'});throw error;}finally{client.release();}
    }else{
      const db=readDb(),row=db.transactions.find(x=>x.id===id);if(!row||!['auto-rejected','rejected'].includes(row.status))return json(res,409,{error:'not_reopenable'});
      if(tx.type==='deposit'&&reopenTeamId){const account=(db.teamAccounts||[]).find(item=>item.id===reopenTeamId);if(account&&Number(account.collateralTotal||0)>0){const exposure=teamCollateralMetrics(reopenTeamId,db.transactions||[],db.walletAddresses||[],db.depositIntents||[]).collateralExposure;if(exposure+Number(tx.requestedAmount??tx.amount)>Number(account.collateralTotal)+1e-8)return json(res,409,{error:'team_collateral_limit_exceeded',message:'Bu yatırım talebi yeniden açıldığında ekip teminat sınırı aşılacak.'});}}
      row.status='pending';row.decisionBy=null;row.decisionAt=null;row.lockedBy=null;row.lockedAt=null;row.expiresAt=expiresAt;if(reopenTeamId)row.teamAccountId=reopenTeamId;
      if(tx.type==='deposit'&&reopenTeamId){const exposure=teamCollateralMetrics(reopenTeamId,db.transactions||[],db.walletAddresses||[],db.depositIntents||[]).collateralExposure;collateralResult=await syncTeamCollateral({teamId:reopenTeamId,exposure,dbState:db,at:new Date().toISOString()});}
      writeDb(db);
    }
    if(collateralResult?.autoPausedTeamAccountId)addAudit('team_account_collateral_auto_paused',reopenTeamId,{teamAccountId:reopenTeamId,transactionId:id});
    addAudit('transaction_reopen',admin.email,{transactionId:id,expiresAt});return json(res,200,{ok:true,status:'pending',expiresAt});
  }
  if(adminQuery.pathname==='/api/admin/transactions/decision' && req.method==='POST'){
    if(!admin)return json(res,401,{error:'unauthorized'}); const b=await body(req); const id=String(b.transactionId||''); const decision=['approved','rejected'].includes(b.decision)?b.decision:null; if(!decision)return json(res,400,{error:'invalid_decision'});
    const all=await getTransactions(); const tx=all.find(x=>x.id===id); if(!tx||teamAdmin&&!owner&&!(await teamOwnsTransaction(teamAdmin.adminId,tx,all)))return json(res,404,{error:'transaction_not_found'}); if(tx.isSynthetic&&(!owner||!requestedTestRunId||tx.testRunId!==requestedTestRunId))return json(res,404,{error:'transaction_not_found'}); if(tx.status!=='pending')return json(res,409,{error:'already_processed',status:tx.status});
    if(isLocked(tx) && tx.lockedBy!==admin.email)return json(res,409,{error:'transaction_locked',lockedBy:tx.lockedBy});
    const requestedAmount=Number(tx.requestedAmount??tx.requested_amount??tx.amount); const rawApproved=b.approvedAmount; const approvedAmount=decision==='approved' && rawApproved!==undefined && rawApproved!==null && rawApproved!==''?Number(rawApproved):Number(tx.amount); if(decision==='approved'&&(!Number.isFinite(approvedAmount)||approvedAmount<=0))return json(res,400,{error:'invalid_approved_amount'});
    const approvalWallets=await getWalletAddresses(),approvalWalletById=new Map(approvalWallets.map(wallet=>[wallet.id,wallet])),resolvedTeamAccountId=transactionTeamId(tx,all,approvalWalletById)||(teamAdmin&&!owner?teamAdmin.adminId:null),approvalTeam=resolvedTeamAccountId?(await getTeamAccounts()).find(account=>account.id===resolvedTeamAccountId):null,chainVerificationRequired=approvalTeam?approvalTeam.requireChainVerification!==false:true;
    const payoutTxHash=tx.type==='withdrawal'&&decision==='approved'&&!tx.isSynthetic?(String(b.payoutTxHash||'').trim()||null):null;
    if(payoutTxHash&&payoutTxHash.length<16)return json(res,400,{error:'payout_tx_hash_required',message:'Gönderim işlem kimliğini kontrol edin.'});
    const chainCheckApplies=decision==='approved'&&!tx.isSynthetic&&['deposit','withdrawal'].includes(tx.type);
    if(chainCheckApplies){
      const transferHash=tx.type==='withdrawal'?payoutTxHash:String(tx.txHash||'').trim();
      if(chainVerificationRequired&&!transferHash)return json(res,400,{error:'chain_transfer_required',message:tx.type==='withdrawal'?'Ödemeyi zincirde doğrulamak için çekim işlem kimliğini girin.':'Yatırımın zincir işlem kimliği bulunamadı.'});
      if(transferHash&&all.some(item=>item.id!==tx.id&&item.txHash&&item.txHash.toLowerCase()===transferHash.toLowerCase()))return json(res,409,{error:'chain_transfer_already_used',message:'Bu zincir işlem kimliği başka bir işlemde kullanılmış.'});
      if(chainVerificationRequired){
        const verification=await verifyUsdtTransfer({network:tx.network,txHash:transferHash,recipient:tx.address,amount:approvedAmount});
        addAudit('chain_transfer_check',admin.email,{transactionId:id,network:tx.network,type:tx.type,txHash:transferHash,status:verification.status,reason:verification.reason,blockNumber:verification.blockNumber||null});
        if(verification.status!=='verified')return json(res,409,{error:'chain_transfer_unverified',message:chainVerificationMessage(verification.reason,tx.network)});
      }
    }
    if(decision==='approved' && tx.type==='withdrawal'){const u=await findUserById(tx.userId);if(approvedAmount>Number(u.balance||0))return json(res,409,{error:'insufficient_balance_at_approval'});}
    const decisionAt=new Date().toISOString(); const amountChanged=Math.abs(approvedAmount-requestedAmount)>1e-8;
    let decisionTeamAccountId=resolvedTeamAccountId||null;
    let decisionResult;
    if(pool){const client=await pool.connect(); try {await client.query('BEGIN'); const lock=await client.query("SELECT status, locked_by FROM transactions WHERE id=$1 FOR UPDATE",[id]); if(!lock.rows[0]||lock.rows[0].status!=='pending'){await client.query('ROLLBACK');return json(res,409,{error:'already_processed'});} if(lock.rows[0].locked_by&&lock.rows[0].locked_by!==admin.email){await client.query('ROLLBACK');return json(res,409,{error:'transaction_locked',lockedBy:lock.rows[0].locked_by});} if(decision==='approved'&&tx.type==='withdrawal'){const lockedUser=await client.query('SELECT balance FROM users WHERE id=$1 FOR UPDATE',[tx.userId]);if(!lockedUser.rows[0]||approvedAmount>Number(lockedUser.rows[0].balance||0)){await client.query('ROLLBACK');return json(res,409,{error:'insufficient_balance_at_approval'});}} decisionResult=await applyTransactionDecision({tx,decision,approvedAmount,actor:admin.email,decisionAt,payoutTxHash,client,teamAccountId:decisionTeamAccountId}); await client.query('COMMIT');} catch(e){await client.query('ROLLBACK');if(e.message==='team_collateral_limit_exceeded')return json(res,409,{error:'team_collateral_limit_exceeded',message:'Bu yatırım onaylandığında ekibin teminat sınırı aşılacak.'});throw e;} finally{client.release();}}
    else{const db=readDb();const row=db.transactions.find(x=>x.id===id);if(!row||row.status!=='pending')return json(res,409,{error:'already_processed'});if(row.lockedBy&&row.lockedBy!==admin.email&&isLocked(row))return json(res,409,{error:'transaction_locked',lockedBy:row.lockedBy});try{decisionResult=await applyTransactionDecision({tx,decision,approvedAmount,actor:admin.email,decisionAt,payoutTxHash,dbState:db,teamAccountId:decisionTeamAccountId});}catch(e){if(e.message==='negative_balance')return json(res,409,{error:'negative_balance_at_approval'});if(e.message==='team_collateral_limit_exceeded')return json(res,409,{error:'team_collateral_limit_exceeded',message:'Bu yatırım onaylandığında ekibin teminat sınırı aşılacak.'});throw e;}writeDb(db);}
    if(decisionResult?.autoPausedTeamAccountId)addAudit('team_account_collateral_auto_paused',decisionResult.autoPausedTeamAccountId,{teamAccountId:decisionResult.autoPausedTeamAccountId,transactionId:id,approvedAmount});
    if(decisionResult?.autoResumedTeamAccountId)addAudit('team_account_collateral_auto_resumed',decisionResult.autoResumedTeamAccountId,{teamAccountId:decisionResult.autoResumedTeamAccountId,transactionId:id,approvedAmount});
    const chainVerificationBypassed=chainCheckApplies&&!chainVerificationRequired;if(chainVerificationBypassed)addAudit('transaction_chain_verification_bypassed',admin.email,{transactionId:id,teamAccountId:resolvedTeamAccountId,type:tx.type,network:tx.network,txHash:payoutTxHash||tx.txHash||null});
    addAudit('transaction_decision',admin.email,{transactionId:id,userId:tx.userId,type:tx.type,decision,requestedAmount,approvedAmount,amountChanged,payoutTxHash,teamAccountId:resolvedTeamAccountId,chainVerificationRequired:chainCheckApplies?chainVerificationRequired:null,chainVerificationBypassed}); return json(res,200,{ok:true,status:decision,decisionBy:admin.email,decisionAt,requestedAmount,approvedAmount,amountChanged,payoutTxHash,teamAccountId:resolvedTeamAccountId,chainVerificationRequired:chainCheckApplies?chainVerificationRequired:null,chainVerificationBypassed});
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
    const loginName=identifier.toLowerCase().replace(/^@/,'');
    const u=users.find(x=>String(x.email||'').toLowerCase()===loginName || normalizePhone(x.phone)===normalized || String(x.username||'').toLowerCase()===loginName);
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
    if(pool){const r=await pool.query('SELECT id,user_id AS "userId",subject,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC',[uid]);const ids=r.rows.map(x=>x.id);const m=ids.length?await pool.query('SELECT id,ticket_id AS "ticketId",sender_role AS "senderRole",sender_id AS "senderId",message,attachments,created_at AS "createdAt" FROM support_messages WHERE ticket_id=ANY($1::text[]) ORDER BY created_at',[ids]):{rows:[]};const byId=new Map();for(const msg of m.rows){if(!byId.has(msg.ticketId))byId.set(msg.ticketId,[]);byId.get(msg.ticketId).push(msg);}return json(res,200,{tickets:r.rows.map(x=>({...x,messages:byId.get(x.id)||[]}))});}
    const db=readDb();return json(res,200,{tickets:(db.supportTickets||[]).filter(x=>x.userId===uid).map(t=>({...t,messages:(db.supportMessages||[]).filter(m=>m.ticketId===t.id)})).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))});
  }
  if(req.url==='/api/support/tickets' && req.method==='POST'){
    if(!uid)return json(res,401,{error:'unauthorized'});const b=await body(req,6e6),subject=String(b.subject||'').trim().slice(0,160),message=String(b.message||'').trim().slice(0,4000),attachments=cleanSupportAttachments(b.attachments);if(subject.length<3||(!message&&!attachments.length))return json(res,400,{error:'invalid_ticket'});
    const user=await findUserById(uid),now=new Date().toISOString(),ticket={id:`SUP-${crypto.randomBytes(7).toString('hex').toUpperCase()}`,userId:uid,userName:[user?.firstName,user?.lastName].filter(Boolean).join(' ')||uid,subject,status:'open',createdAt:now,updatedAt:now},item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId:ticket.id,senderRole:'user',senderId:uid,message,attachments,createdAt:now};
    if(pool){const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO support_tickets (id,user_id,subject,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)',[ticket.id,uid,ticket.subject,ticket.status,now,now]);await client.query('INSERT INTO support_messages (id,ticket_id,sender_role,sender_id,message,attachments,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',[item.id,ticket.id,item.senderRole,item.senderId,item.message,JSON.stringify(attachments),now]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
    else{const db=readDb();db.supportTickets=db.supportTickets||[];db.supportMessages=db.supportMessages||[];db.supportTickets.unshift(ticket);db.supportMessages.push(item);writeDb(db);}
    await forwardSupportMessageToTelegram(ticket,item);
    return json(res,201,{ok:true,ticket:{...ticket,messages:[item]}});
  }
  const memberSupportMatch=new URL(req.url,'http://localhost').pathname.match(/^\/api\/support\/tickets\/([^/]+)(?:\/(messages|close))?$/);
  if(memberSupportMatch){
    if(!uid)return json(res,401,{error:'unauthorized'});const ticketId=decodeURIComponent(memberSupportMatch[1]),sub=memberSupportMatch[2]||'';
    if(!sub&&req.method==='GET'){
      if(pool){const r=await pool.query('SELECT id,user_id AS "userId",subject,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM support_tickets WHERE id=$1 AND user_id=$2',[ticketId,uid]);if(!r.rows[0])return json(res,404,{error:'ticket_not_found'});const m=await pool.query('SELECT id,ticket_id AS "ticketId",sender_role AS "senderRole",sender_id AS "senderId",message,attachments,created_at AS "createdAt" FROM support_messages WHERE ticket_id=$1 ORDER BY created_at',[ticketId]);return json(res,200,{ticket:{...r.rows[0],messages:m.rows}});}
      const db=readDb(),ticket=(db.supportTickets||[]).find(x=>x.id===ticketId&&x.userId===uid);if(!ticket)return json(res,404,{error:'ticket_not_found'});return json(res,200,{ticket:{...ticket,messages:(db.supportMessages||[]).filter(m=>m.ticketId===ticketId)}});
    }
    if(sub==='messages'&&req.method==='POST'){
      const b=await body(req,6e6),message=String(b.message||'').trim().slice(0,4000),attachments=cleanSupportAttachments(b.attachments);if(!message&&!attachments.length)return json(res,400,{error:'empty_message'});
      const user=await findUserById(uid),item={id:`MSG-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,ticketId,senderRole:'user',senderId:uid,message,attachments,createdAt:new Date().toISOString()};
      if(pool){const client=await pool.connect();try{await client.query('BEGIN');const t=await client.query("SELECT id,subject FROM support_tickets WHERE id=$1 AND user_id=$2 AND status<>'closed' FOR UPDATE",[ticketId,uid]);if(!t.rows[0]){await client.query('ROLLBACK');return json(res,404,{error:'ticket_not_found'});}await client.query('INSERT INTO support_messages (id,ticket_id,sender_role,sender_id,message,attachments,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',[item.id,ticketId,item.senderRole,item.senderId,item.message,JSON.stringify(attachments),item.createdAt]);await client.query('UPDATE support_tickets SET updated_at=$1 WHERE id=$2',[item.createdAt,ticketId]);await client.query('COMMIT');item.ticketSubject=t.rows[0].subject;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
      else{const db=readDb(),t=(db.supportTickets||[]).find(x=>x.id===ticketId&&x.userId===uid&&x.status!=='closed');if(!t)return json(res,404,{error:'ticket_not_found'});db.supportMessages=db.supportMessages||[];db.supportMessages.push(item);t.updatedAt=item.createdAt;writeDb(db);}
      await forwardSupportMessageToTelegram({id:ticketId,subject:item.ticketSubject||supportSubject,userId:uid,userName:[user?.firstName,user?.lastName].filter(Boolean).join(' ')||uid},item);
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
    const referrals=users.filter(x=>x.referredBy===uid||x.referredBy===user?.referralCode).map(x=>{const own=tx.filter(t=>t.userId===x.id);return {id:x.id,name:[x.firstName,x.lastName].filter(Boolean).join(' '),createdAt:x.createdAt,hasApprovedDeposit:own.some(t=>t.type==='deposit'&&t.status==='approved')};});
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
    const available=(await getWalletAddresses()).filter(w=>w.network===network&&w.active!==false);if(!available.length)return json(res,409,{error:'wallet_unavailable',message:'Bu ağ için aktif yatırım adresi henüz yapılandırılmadı.'});
    const now=new Date(),expiresAt=new Date(now.getTime()+20*60*1000).toISOString();let wallet,intent;
    if(pool){
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const candidates=await client.query('SELECT w.id,w.network,w.address,w.label,w.team_id AS "teamId",w.min_deposit_amount AS "minDepositAmount",w.max_deposit_amount AS "maxDepositAmount" FROM wallet_addresses w LEFT JOIN team_accounts t ON t.id=w.team_id WHERE w.network=$1 AND w.active=TRUE AND (w.team_id IS NULL OR (t.active=TRUE AND t.deposits_paused=FALSE)) ORDER BY w.last_used_at NULLS FIRST,w.use_count,w.created_at FOR UPDATE OF w SKIP LOCKED',[network]);
        let capacityBlocked=false,amountLimitBlocked=false;
        for(const candidate of candidates.rows){
          if((candidate.minDepositAmount!==null&&candidate.minDepositAmount!==undefined&&amount<Number(candidate.minDepositAmount))||(candidate.maxDepositAmount!==null&&candidate.maxDepositAmount!==undefined&&amount>Number(candidate.maxDepositAmount))){amountLimitBlocked=true;continue;}
          if(candidate.teamId){
            const lockedTeam=await client.query('SELECT id,collateral_total AS "collateralTotal",collateral_auto_pause AS "collateralAutoPause",collateral_pause_percent AS "collateralPausePercent",collateral_paused AS "collateralPaused",deposits_paused AS "depositsPaused",active FROM team_accounts WHERE id=$1 FOR UPDATE',[candidate.teamId]);
            const team=lockedTeam.rows[0];if(!team)continue;
            const exposure=await getTeamCollateralExposure(client,candidate.teamId),total=Number(team.collateralTotal||0),threshold=total*Number(team.collateralPausePercent||80)/100;
            const pauseLimit=total>0?(team.collateralAutoPause?threshold:total):Infinity;
            if(team.collateralPaused&&exposure<pauseLimit-1e-8){await syncTeamCollateral({teamId:candidate.teamId,exposure,client,at:now.toISOString()});team.collateralPaused=false;}
            if(team.active===false||team.depositsPaused)continue;
            if(team.collateralPaused){capacityBlocked=true;continue;}
            if(total>0&&exposure+amount>total+1e-8){capacityBlocked=true;continue;}
            if(total>0&&team.collateralAutoPause&&exposure>=threshold-1e-8){await syncTeamCollateral({teamId:candidate.teamId,exposure,client,at:now.toISOString()});capacityBlocked=true;continue;}
          }
          wallet=candidate;break;
        }
        if(!wallet){await client.query('COMMIT');return json(res,409,capacityBlocked?{error:'team_collateral_limit_exceeded',message:'Ekip teminat kapasitesi dolu; ekip çekimleri ödedikten sonra yeniden yatırım kabul edebilir.'}:amountLimitBlocked?{error:'deposit_amount_limits',message:'Girdiğiniz tutar bu ağdaki yatırım cüzdanlarının alt/üst limitlerine uymuyor.'}:{error:'wallet_unavailable'});}
        await client.query('UPDATE wallet_addresses SET use_count=use_count+1,last_used_at=$1,updated_at=$1 WHERE id=$2',[now.toISOString(),wallet.id]);
        intent={id:`DPI-${crypto.randomBytes(12).toString('hex').toUpperCase()}`,userId:uid,walletId:wallet.id,amount,network,createdAt:now.toISOString(),expiresAt};
        await client.query('INSERT INTO deposit_intents (id,user_id,wallet_id,amount,network,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[intent.id,uid,wallet.id,amount,network,intent.createdAt,intent.expiresAt]);
        if(wallet.teamId){const team=await client.query('SELECT id FROM team_accounts WHERE id=$1 FOR UPDATE',[wallet.teamId]);if(team.rows[0]){const exposure=await getTeamCollateralExposure(client,wallet.teamId);await syncTeamCollateral({teamId:wallet.teamId,exposure,client,at:now.toISOString()});}}
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    }else{
      const db=readDb(),walletById=new Map((db.walletAddresses||[]).map(item=>[item.id,item]));let capacityBlocked=false;
      const candidates=available.sort((a,b)=>Number(a.useCount||0)-Number(b.useCount||0)||new Date(a.lastUsedAt||0)-new Date(b.lastUsedAt||0));let amountLimitBlocked=false;
      for(const candidate of candidates){
        if((candidate.minDepositAmount!==null&&candidate.minDepositAmount!==undefined&&amount<Number(candidate.minDepositAmount))||(candidate.maxDepositAmount!==null&&candidate.maxDepositAmount!==undefined&&amount>Number(candidate.maxDepositAmount))){amountLimitBlocked=true;continue;}
        if(candidate.teamId){
          const team=(db.teamAccounts||[]).find(item=>item.id===candidate.teamId);if(!team)continue;
          const exposure=teamCollateralMetrics(candidate.teamId,db.transactions||[],db.walletAddresses||[],db.depositIntents||[]).collateralExposure,total=Number(team.collateralTotal||0),threshold=total*Number(team.collateralPausePercent||80)/100,pauseLimit=total>0?(team.collateralAutoPause?threshold:total):Infinity;
          if(team.collateralPaused&&exposure<pauseLimit-1e-8)await syncTeamCollateral({teamId:candidate.teamId,exposure,dbState:db,at:now.toISOString()});
          if(team.active===false||team.depositsPaused)continue;
          if(team.collateralPaused){capacityBlocked=true;continue;}
          if(total>0&&exposure+amount>total+1e-8){capacityBlocked=true;continue;}
          if(total>0&&team.collateralAutoPause&&exposure>=threshold-1e-8){
            await syncTeamCollateral({teamId:candidate.teamId,exposure,dbState:db,at:now.toISOString()});
            capacityBlocked=true;continue;
          }
        }
        wallet=candidate;break;
      }
      if(!wallet){if(capacityBlocked)writeDb(db);return json(res,409,capacityBlocked?{error:'team_collateral_limit_exceeded',message:'Ekip teminat kapasitesi dolu; ekip çekimleri ödedikten sonra yeniden yatırım kabul edebilir.'}:amountLimitBlocked?{error:'deposit_amount_limits',message:'Girdiğiniz tutar bu ağdaki yatırım cüzdanlarının alt/üst limitlerine uymuyor.'}:{error:'wallet_unavailable'});}
      const saved=walletById.get(wallet.id);saved.useCount=Number(saved.useCount||0)+1;saved.lastUsedAt=now.toISOString();saved.updatedAt=now.toISOString();
      intent={id:`DPI-${crypto.randomBytes(12).toString('hex').toUpperCase()}`,userId:uid,walletId:wallet.id,amount,network,createdAt:now.toISOString(),expiresAt,usedAt:null};db.depositIntents=db.depositIntents||[];db.depositIntents.unshift(intent);
      if(wallet.teamId){const team=(db.teamAccounts||[]).find(item=>item.id===wallet.teamId);if(team){const exposure=teamCollateralMetrics(wallet.teamId,db.transactions||[],db.walletAddresses||[],db.depositIntents).collateralExposure;await syncTeamCollateral({teamId:wallet.teamId,exposure,dbState:db,at:now.toISOString()});}}
      writeDb(db);
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
    const cooldown=await requestCooldownRemaining(uid,'deposit');
    if(cooldown>0)return json(res,429,{error:'request_cooldown',cooldownSeconds:Math.ceil(cooldown/1000),message:'Yeni yatırım talebi için '+Math.ceil(cooldown/1000)+' saniye beklemelisiniz.'});
    const createdAt=new Date(); const tx={id:makeTxId(),userId:uid,type:'deposit',amount,requestedAmount:amount,receivedAmount:null,currency:'USDT',network,status:'pending',createdAt:createdAt.toISOString(),txHash,address:wallet.address,walletId:wallet.id,teamAccountId:wallet.teamId||null,requestKey,expiresAt:new Date(createdAt.getTime()+TX_CONTROL.autoRejectMinutes*60000).toISOString()};
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
    await startRequestCooldown(uid,'deposit'); addAudit('deposit_request',uid,{transactionId:tx.id,amount,network});
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
    const cooldown=await requestCooldownRemaining(uid,'withdrawal');
    if(cooldown>0)return json(res,429,{error:'request_cooldown',cooldownSeconds:Math.ceil(cooldown/1000),message:'Yeni çekim talebi için '+Math.ceil(cooldown/1000)+' saniye beklemelisiniz.'});
    await startRequestCooldown(uid,'withdrawal');
    const createdAt=new Date(); const tx={id:makeTxId(),userId:uid,type:'withdrawal',amount,requestedAmount:amount,receivedAmount:null,currency:'USDT',network,status:'pending',createdAt:createdAt.toISOString(),txHash:null,address,requestKey,expiresAt:new Date(createdAt.getTime()+TX_CONTROL.autoRejectMinutes*60000).toISOString()};
    await insertTransaction(tx); addAudit('withdrawal_request',uid,{transactionId:tx.id,amount,network});
    return json(res,201,{ok:true,transaction:tx,requestKey,message:'Çekim talebi alındı. Yeni talep oluşturabilirsiniz; her talep ayrı işlem ID ile kaydedilir.'});
  }

  if(req.url==='/api/transactions' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'}); const tx=(await getTransactions()).filter(x=>x.userId===uid); return json(res,200,{transactions:tx.map(safeTransaction)});
  }
  if(req.url==='/api/ledger' && req.method==='GET'){
    if(!uid)return json(res,401,{error:'unauthorized'}); return json(res,200,{ledger:(await getLedger(uid)).map(safeLedgerEntry)});
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
pgInit().then(()=>http.createServer((req,res)=>route(req,res).catch(e=>{console.error(e);if(e?.message==='support_attachment_invalid')return json(res,400,{error:'support_attachment_invalid',message:'Ek dosya PDF, PNG veya JPG olmalı; toplam boyut en fazla 4 MB olabilir.'});if(e?.statusCode===413)return json(res,413,{error:'payload_too_large',message:'Gönderilen veri boyutu sınırı aşıyor.'});const path=String(req.url||'');if(path.startsWith('/api/support/tickets'))return json(res,500,{error:'support_persistence_failed',message:'Destek mesajı kaydedilemedi. Sunucu bağlantısını kontrol edip tekrar deneyin.'});json(res,500,{error:'server_error'})})).listen(PORT,'0.0.0.0',()=>console.log(`Safepays v29 running: http://localhost:${PORT}`))).catch(e=>{console.error('DB init failed',e);process.exit(1)});
