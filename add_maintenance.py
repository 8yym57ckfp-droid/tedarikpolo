from pathlib import Path
import re
root=Path('/mnt/data/v247')

# 1) Server: global maintenance API
p=root/'server/server.js'
s=p.read_text()
needle="const requestCooldowns = new Map();\nconst REQUEST_COOLDOWN_MS = 120000;"
insert="""const requestCooldowns = new Map();
const REQUEST_COOLDOWN_MS = 120000;
const DEFAULT_MAINTENANCE = {
  site: { enabled:false, until:null, message:'Sitemiz güncelleniyor. Daha iyi bir deneyim için kısa bir bakım çalışması yapıyoruz.' },
  panel: { enabled:false, until:null, message:'Yönetim paneli güncelleniyor. Ekip erişimi bakım tamamlandığında yeniden açılacaktır.' }
};
function getMaintenance(){ const db=readDb(); return {site:{...DEFAULT_MAINTENANCE.site,...(db.maintenance?.site||{})},panel:{...DEFAULT_MAINTENANCE.panel,...(db.maintenance?.panel||{})}}; }
function saveMaintenance(next){ const db=readDb(); db.maintenance=next; writeDb(db); return next; }
function maintenanceScope(scope){ const m=getMaintenance(); return scope==='panel'?m.panel:m.site; }
"""
if needle not in s: raise SystemExit('server needle not found')
s=s.replace(needle,insert,1)
needle2="  if(req.url==='/api/health' && req.method==='GET') return json(res,200,{ok:true,service:'safepays-api',version:'35.0.0'});\n"
insert2="""  if(req.url==='/api/health' && req.method==='GET') return json(res,200,{ok:true,service:'safepays-api',version:'35.0.0'});
  if(req.url==='/api/system/maintenance' && req.method==='GET') return json(res,200,{maintenance:getMaintenance()});
"""
if needle2 not in s: raise SystemExit('health needle not found')
s=s.replace(needle2,insert2,1)
needle3="  if(req.url==='/api/admin/me' && req.method==='GET'){\n"
insert3="""  if(req.url==='/api/admin/maintenance' && req.method==='GET'){
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
"""
if needle3 not in s: raise SystemExit('admin me needle not found')
s=s.replace(needle3,insert3+needle3,1)
p.write_text(s)

# 2) Admin API helper
p=root/'admin/admin-api.js'
s=p.read_text()
s += "\nasync function getMaintenanceSettings(){return adminFetch('/maintenance');}\nasync function saveMaintenanceSettings(payload){return adminFetch('/maintenance',{method:'POST',body:JSON.stringify(payload)});}\n"
p.write_text(s)

# 3) Shared maintenance CSS/JS
css=r'''.maintenance-page{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:radial-gradient(circle at 50% -10%,rgba(164,60,255,.20),transparent 38%),radial-gradient(circle at 10% 90%,rgba(37,133,255,.12),transparent 35%),#070211;color:#f8f3ff;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.maintenance-shell{width:min(680px,100%);background:linear-gradient(145deg,rgba(25,10,40,.98),rgba(10,4,20,.98));border:1px solid #51227b;border-radius:28px;padding:34px;box-shadow:0 30px 90px rgba(0,0,0,.55),0 0 60px rgba(145,47,255,.12);text-align:center}.maintenance-logo{display:inline-flex;align-items:center;gap:10px;font-weight:900;font-size:23px;margin-bottom:26px}.maintenance-logo-mark{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#1e8bff,#a43cff);box-shadow:0 8px 28px rgba(92,52,255,.3);font-weight:1000}.maintenance-kicker{font-size:10px;letter-spacing:.22em;color:#a765db;font-weight:900;text-transform:uppercase}.maintenance-title{font-size:clamp(30px,6vw,48px);line-height:1.04;letter-spacing:-.04em;margin:9px 0 14px}.maintenance-message{color:#bcaaca;line-height:1.7;font-size:14px;margin:0 auto;max-width:540px}.maintenance-status{margin:24px auto 0;padding:17px 18px;border-radius:17px;border:1px solid #43205f;background:#12081f;text-align:left}.maintenance-status-row{display:flex;justify-content:space-between;gap:14px;align-items:center}.maintenance-status-label{color:#917da2;font-size:11px;font-weight:800}.maintenance-countdown{font-variant-numeric:tabular-nums;font-size:20px;font-weight:900;color:#fff}.maintenance-date{color:#a993b7;font-size:11px;margin-top:7px}.maintenance-progress{height:7px;border-radius:999px;background:#241032;overflow:hidden;margin-top:17px}.maintenance-progress>i{display:block;height:100%;width:65%;border-radius:inherit;background:linear-gradient(90deg,#238cff,#a43cff)}.maintenance-note{margin-top:20px;color:#7e6b8d;font-size:11px}.maintenance-live{display:inline-flex;align-items:center;gap:7px;margin-top:20px;padding:8px 12px;border-radius:999px;background:rgba(53,224,160,.08);border:1px solid #225c4a;color:#62efbb;font-size:10px;font-weight:900}.maintenance-live i{width:7px;height:7px;border-radius:50%;background:#35e0a0;box-shadow:0 0 12px #35e0a0}.maintenance-error{color:#ff9aa4!important}.maintenance-hide{display:none!important}@media(max-width:600px){.maintenance-shell{padding:26px 19px;border-radius:22px}.maintenance-status-row{align-items:flex-start;flex-direction:column;gap:4px}.maintenance-countdown{font-size:18px}}
'''
(root/'assets/maintenance.css').write_text(css)
js=r'''(function(){
  const KEY='safepays_maintenance_v1';
  function local(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}}
  function saveLocal(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
  function scope(){const p=location.pathname;return p.includes('/admin/')?'panel':(p.includes('/owner/')?'owner':'site')}
  function bypass(){return scope()==='owner'||location.pathname.endsWith('/maintenance.html')}
  async function get(){
    try{const r=await fetch('/api/system/maintenance',{cache:'no-store'});if(!r.ok)throw Error('api');const d=await r.json();saveLocal(d.maintenance);return d.maintenance}catch(e){return local()||{site:{enabled:false},panel:{enabled:false}}}
  }
  function active(item){if(!item||!item.enabled)return false;if(item.until&&new Date(item.until).getTime()<=Date.now())return false;return true}
  async function guard(){
    if(bypass())return;
    const m=await get();const s=scope();const item=m?.[s];
    if(active(item)){sessionStorage.setItem('safepays_maintenance_return',location.href);location.replace('/maintenance.html?scope='+encodeURIComponent(s));}
  }
  window.SafePaysMaintenance={get,saveLocal,active,scope,guard};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',guard);else guard();
})();
'''
(root/'assets/maintenance.js').write_text(js)

# 4) Maintenance page
page=r'''<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SafePays — Güncelleme Çalışması</title><link rel="stylesheet" href="assets/maintenance.css"><script src="assets/maintenance.js"></script></head><body class="maintenance-page"><main class="maintenance-shell"><div class="maintenance-logo"><span class="maintenance-logo-mark">S</span><span>Safe<span style="color:#a43cff">Pays</span></span></div><div class="maintenance-kicker" id="scopeKicker">SİSTEM GÜNCELLENİYOR</div><h1 class="maintenance-title" id="title">Kısa bir güncelleme yapıyoruz</h1><p class="maintenance-message" id="message">Sitemiz daha iyi bir deneyim sunmak için güncelleniyor.</p><section class="maintenance-status"><div class="maintenance-status-row"><div><div class="maintenance-status-label">TAHMİNİ TAMAMLANMA</div><div class="maintenance-date" id="date">—</div></div><div class="maintenance-countdown" id="countdown">Hesaplanıyor…</div></div><div class="maintenance-progress"><i id="progress"></i></div></section><div class="maintenance-live"><i></i><span>Güncelleme durumu canlı olarak kontrol ediliyor</span></div><div class="maintenance-note">Çalışma tamamlandığında sayfa otomatik olarak yeniden açılacaktır.</div></main><script>
(async function(){
 const q=new URLSearchParams(location.search),s=q.get('scope')==='panel'?'panel':'site';
 const title=document.getElementById('title'),msg=document.getElementById('message'),date=document.getElementById('date'),cd=document.getElementById('countdown'),k=document.getElementById('scopeKicker'),bar=document.getElementById('progress');
 function active(x){return x&&x.enabled&&(!x.until||new Date(x.until).getTime()>Date.now())}
 function render(m){const x=m?.[s]||{};if(s==='panel'){k.textContent='YÖNETİM PANELİ GÜNCELLENİYOR';title.textContent='Panel kısa süreliğine bakımda';}else{k.textContent='SAFEPAYS GÜNCELLENİYOR';title.textContent='Sitemizi güncelliyoruz';}msg.textContent=x.message||'Daha iyi bir deneyim için kısa bir güncelleme çalışması yapıyoruz.';if(x.until){const t=new Date(x.until);date.textContent=t.toLocaleString('tr-TR',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});const sec=Math.max(0,t.getTime()-Date.now());const h=Math.floor(sec/3600000),m=Math.floor(sec%3600000/60000),ss=Math.floor(sec%60000/1000);cd.textContent=(h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(ss).padStart(2,'0');bar.style.width=Math.min(100,Math.max(8,100-(sec/(24*3600000))*100))+'%';}else{date.textContent='Süre owner tarafından belirlenmedi';cd.textContent='Devam ediyor';bar.style.width='45%';}}
 async function tick(){try{const m=await SafePaysMaintenance.get();render(m);if(!active(m?.[s])){const back=sessionStorage.getItem('safepays_maintenance_return')||('/'+(s==='panel'?'admin/login.html':'index.html'));sessionStorage.removeItem('safepays_maintenance_return');location.replace(back);}}catch(e){cd.textContent='Devam ediyor';}}
 await tick();setInterval(tick,1000);
})();</script></body></html>'''
(root/'maintenance.html').write_text(page)

# 5) Owner management page
owner_page=r'''<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SafePays Owner — Panel & Site Yönetimi</title><link rel="stylesheet" href="../assets/styles.css"><link rel="stylesheet" href="../admin/admin.css"><link rel="stylesheet" href="../assets/dark-theme.css"><link rel="stylesheet" href="../assets/owner.css"><script src="../admin/admin-store.js"></script><script src="../admin/admin-api.js"></script><script src="owner.js"></script></head><body class="admin-body owner-page"><div class="admin-layout"><aside class="admin-side"><a class="logo" href="dashboard.html">Safe<span>Pays</span><small>OWNER PANEL</small></a><nav class="admin-nav"></nav></aside><main class="admin-main"><div class="admin-head"><div><div class="admin-muted">CONTROL CENTER</div><h1>Panel & Site Yönetimi</h1><div class="admin-muted">Siteyi veya ekip yönetim panelini bakım moduna al, bitiş zamanını belirle ve kullanıcılara gösterilecek mesajı yönet.</div></div><div class="maint-live-pill" id="globalState">Durum kontrol ediliyor…</div></div><div class="maint-grid"><section class="admin-card maint-card"><div class="maint-card-head"><div><span class="maint-icon">◈</span><div><h2>Üye Sitesi</h2><p>Üyelerin göreceği bakım ekranını yönet.</p></div></div><label class="switch"><input id="siteEnabled" type="checkbox"><span></span></label></div><div class="maint-status" id="siteStatus">Kapalı</div><div class="maint-fields"><div class="field"><label>Bitiş tarihi ve saati</label><input id="siteUntil" type="datetime-local"></div><div class="field"><label>Üyelere gösterilecek mesaj</label><textarea id="siteMessage" rows="4" maxlength="240">Sitemiz güncelleniyor. Daha iyi bir deneyim için kısa bir bakım çalışması yapıyoruz.</textarea></div></div></section><section class="admin-card maint-card"><div class="maint-card-head"><div><span class="maint-icon panel">◆</span><div><h2>Yönetim Paneli</h2><p>Admin / ekip hesabının göreceği bakım ekranını yönet.</p></div></div><label class="switch"><input id="panelEnabled" type="checkbox"><span></span></label></div><div class="maint-status" id="panelStatus">Kapalı</div><div class="maint-fields"><div class="field"><label>Bitiş tarihi ve saati</label><input id="panelUntil" type="datetime-local"></div><div class="field"><label>Ekibe gösterilecek mesaj</label><textarea id="panelMessage" rows="4" maxlength="240">Yönetim paneli güncelleniyor. Ekip erişimi bakım tamamlandığında yeniden açılacaktır.</textarea></div></div></section></div><section class="admin-card maint-preview"><div><div class="admin-muted">ÖNİZLEME</div><h2>Üyelere / Ekibe görünecek ekran</h2><p>Bakım aktif olduğunda sistem otomatik olarak aşağıdaki SafePays güncelleme ekranına yönlendirecek.</p></div><div class="maint-preview-box"><div class="preview-logo"><b>S</b><strong>Safe<span>Pays</span></strong></div><div class="preview-kicker">SİSTEM GÜNCELLENİYOR</div><div class="preview-title">Kısa bir güncelleme yapıyoruz</div><div class="preview-copy">Daha iyi bir deneyim için kısa bir güncelleme çalışması yapıyoruz.</div><div class="preview-count">02:30:00</div></div></section><div class="maint-actions"><button class="admin-btn primary" id="saveBtn">Değişiklikleri Kaydet</button><button class="admin-btn dark" id="reloadBtn">Sunucudan Yenile</button><span id="saveMsg" class="admin-muted"></span></div></main></div><script>
(function(){
 const $=id=>document.getElementById(id);
 const isoFromInput=v=>v?new Date(v).toISOString():null;
 const inputFromIso=v=>{if(!v)return '';const d=new Date(v);const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())};
 function paint(m){const s=m.site||{},p=m.panel||{};$('siteEnabled').checked=!!s.enabled;$('panelEnabled').checked=!!p.enabled;$('siteUntil').value=inputFromIso(s.until);$('panelUntil').value=inputFromIso(p.until);$('siteMessage').value=s.message||'';$('panelMessage').value=p.message||'';status('siteStatus',s);status('panelStatus',p);$('globalState').textContent=(s.enabled||p.enabled)?'Bakım modu aktif':'Bakım modu kapalı';}
 function status(id,x){const e=$(id);e.textContent=x.enabled?'AKTİF':'KAPALI';e.className='maint-status '+(x.enabled?'on':'off')}
 async function load(){try{const d=await getMaintenanceSettings();paint(d.maintenance)}catch(e){$('saveMsg').textContent='Sunucu bağlantısı yok: '+e.message}}
 $('saveBtn').onclick=async()=>{try{const payload={site:{enabled:$('siteEnabled').checked,until:isoFromInput($('siteUntil').value),message:$('siteMessage').value.trim()},panel:{enabled:$('panelEnabled').checked,until:isoFromInput($('panelUntil').value),message:$('panelMessage').value.trim()}};if(payload.site.enabled&&!payload.site.until)throw Error('Üye sitesi aktifken bitiş zamanı girin.');if(payload.panel.enabled&&!payload.panel.until)throw Error('Yönetim paneli aktifken bitiş zamanı girin.');const d=await saveMaintenanceSettings(payload);paint(d.maintenance);$('saveMsg').textContent='Kaydedildi · '+new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});setTimeout(()=>{$('saveMsg').textContent=''},3000)}catch(e){$('saveMsg').textContent=e.message}};
 $('reloadBtn').onclick=load;load();
})();</script><style>
.maint-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px}.maint-card{padding:20px}.maint-card-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.maint-card-head>div:first-child{display:flex;gap:12px}.maint-card h2,.maint-preview h2{margin:0 0 5px;font-size:17px}.maint-card p,.maint-preview p{margin:0;color:#aa98c1;font-size:12px;line-height:1.55}.maint-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:rgba(164,60,255,.12);border:1px solid #6324a1;color:#c17cff;font-size:20px}.maint-icon.panel{background:rgba(35,140,255,.10);border-color:#2d69a3;color:#70b6ff}.switch{position:relative;width:52px;height:30px;display:block;flex:0 0 auto}.switch input{display:none}.switch span{position:absolute;inset:0;background:#24112f;border:1px solid #5a2a88;border-radius:999px;cursor:pointer}.switch span:before{content:'';position:absolute;width:22px;height:22px;left:3px;top:3px;background:#8c789a;border-radius:50%;transition:.2s}.switch input:checked+span{background:rgba(53,224,160,.14);border-color:#2a8666}.switch input:checked+span:before{transform:translateX(22px);background:#35e0a0;box-shadow:0 0 12px rgba(53,224,160,.5)}.maint-status{display:inline-flex;margin:17px 0 12px;padding:6px 10px;border-radius:999px;font-size:10px;font-weight:900}.maint-status.off{color:#aa98c1;background:#1b0d28;border:1px solid #4a2270}.maint-status.on{color:#62efbb;background:rgba(53,224,160,.08);border:1px solid #26765a}.maint-fields{display:grid;gap:13px}.maint-live-pill{padding:8px 12px;border-radius:999px;background:#1a082d;border:1px solid #6324a1;color:#c17cff;font-size:10px;font-weight:900}.maint-preview{margin-top:15px;padding:20px;display:grid;grid-template-columns:1fr 360px;gap:20px;align-items:center}.maint-preview-box{border:1px solid #51227b;border-radius:20px;padding:22px;text-align:center;background:radial-gradient(circle at 50% -20%,rgba(164,60,255,.15),transparent 55%),#0b0415}.preview-logo{display:flex;justify-content:center;align-items:center;gap:8px}.preview-logo b{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(145deg,#238cff,#a43cff)}.preview-logo strong span{color:#a43cff}.preview-kicker{font-size:8px;letter-spacing:.2em;color:#a765db;font-weight:900;margin-top:16px}.preview-title{font-size:23px;font-weight:900;margin:7px 0}.preview-copy{font-size:10px;color:#a993b7;line-height:1.5}.preview-count{margin-top:14px;font-weight:900;color:#fff}.maint-actions{display:flex;gap:10px;align-items:center;margin-top:15px}.maint-actions .admin-muted{font-size:11px}@media(max-width:850px){.maint-grid,.maint-preview{grid-template-columns:1fr}.maint-preview-box{max-width:none}.maint-actions{flex-wrap:wrap}}
</style></body></html>'''
(root/'owner/panel-site-management.html').write_text(owner_page)

# 6) Add nav item in owner.js
p=root/'owner/owner.js'; s=p.read_text()
old="['SİSTEM',[['audit.html','shield','İşlem / Audit Logları'],['settings.html','settings','Ayarlar'],['profile.html','user','Profilim'],['../index.html','back','Siteye Dön']]]"
new="['SİSTEM',[['panel-site-management.html','settings','Panel & Site Yönetimi'],['audit.html','shield','İşlem / Audit Logları'],['settings.html','settings','Ayarlar'],['profile.html','user','Profilim'],['../index.html','back','Siteye Dön']]]"
if old not in s: raise SystemExit('owner nav target not found')
s=s.replace(old,new,1); p.write_text(s)

# 7) Inject maintenance gate into member root pages and admin pages.
def inject(path, rel):
    p=Path(path); s=p.read_text()
    if 'maintenance.js' in s: return
    marker='</head>'
    tag=f'<script src="{rel}"></script>'
    s=s.replace(marker,tag+marker,1)
    p.write_text(s)
for p in root.glob('*.html'): inject(p,'assets/maintenance.js')
for p in (root/'admin').glob('*.html'): inject(p,'../assets/maintenance.js')
# maintenance itself must not self-gate
p=root/'maintenance.html'; s=p.read_text().replace('<script src="assets/maintenance.js"></script>',''); p.write_text(s)

# 8) version note
(root/'V248-NOTES.md').write_text('''# V248 — Panel & Site Yönetimi\n- Owner paneline Panel & Site Yönetimi eklendi.\n- Site ve panel bakım modu, bitiş zamanı ve kullanıcı/ekip mesajı yönetilebilir.\n- /api/system/maintenance public durum endpointi ve /api/admin/maintenance owner backend kontrolü eklendi.\n- Üye sayfaları site bakımı aktifken, admin/ekip sayfaları panel bakımı aktifken SafePays bakım ekranına yönlenir.\n- Owner paneli bakım modundan muaftır.\n- Mobil uyumlu bakım ekranı ve canlı geri sayım eklendi.\n''')
