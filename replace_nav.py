from pathlib import Path
import re

icons={
'🏠 Genel Bakış':('home','<path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 10v10h13V10"/><path d="M9.5 20v-6h5v6"/>'),
'⏳ Beklenen İşlemler':('clock','<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>'),
'✅ Onaylanan İşlemler':('check','<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12 2.4 2.4 5-5"/>'),
'❌ Reddedilen İşlemler':('x','<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>'),
'🤝 Mutabakat':('handshake','<path d="m4 10 3-3 4 3 4-3 3 3"/><path d="M4 10v6l4 3 4-3 4 3 3-3v-6"/><path d="m8 10 4 3 4-3"/>'),
'📊 Raporlar':('chart','<path d="M4 19V9M10 19V5M16 19v-7M21 19H3"/>'),
'👥 Üyeler':('users','<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.3 2.5-5 5.5-5s4.9 1.7 5.5 5"/><path d="M15 6.5a3 3 0 0 1 0 5.8M16 14c2.1.4 3.4 2 4 5"/>'),
'💳 Cüzdan Hesapları':('wallet','<path d="M4 6.5h13.5A2.5 2.5 0 0 1 20 9v8.5A2.5 2.5 0 0 1 17.5 20H5a2 2 0 0 1-2-2V7.5A1.5 1.5 0 0 1 4.5 6H18"/><path d="M15 12h5v4h-5a2 2 0 1 1 0-4Z"/>'),
'💰 Kazanç & Bonuslar':('coins','<circle cx="9" cy="9" r="5.5"/><path d="M9 6.5v5M7 8.5c0-1 4-1 4 0s-4 1-4 2 4 1 4 2"/><path d="M14 14a5.5 5.5 0 0 0 4.5 1.5M15 17a5.5 5.5 0 0 0 2.5 2"/>'),
'📰 İçerik Merkezi':('news','<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 11h8M8 14h5"/>'),
'👨‍💼 Ekip Hesapları':('team','<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3 2.4-4.5 5.5-4.5s5 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.2"/><path d="M15 14c2.6.2 4.2 1.7 4.7 4"/>'),
'🛡️ İşlem / Audit Logları':('shield','<path d="M12 3 19 6v5c0 4.5-2.8 7.4-7 10-4.2-2.6-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>'),
'👤 Profilim':('user','<circle cx="12" cy="8" r="3.2"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/>'),
'⚙️ Ayarlar':('settings','<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.6V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.6-1H6v-2.6h.4A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2.6V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V14h-.2a1.7 1.7 0 0 0-1.6 1Z"/>'),
'🔒 Owner Paneli':('lock','<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
'🔙 Siteye Dön':('back','<path d="M10 6 4 12l6 6"/><path d="M4 12h16"/>'),
}
# Some builds use the lock icon as 🔐.
icons['🔐 Owner Paneli']=icons['🔒 Owner Paneli']

for p in list(Path('/mnt/data/v164edit').rglob('*.html')):
    s=p.read_text(encoding='utf-8', errors='ignore')
    if 'class="admin-nav"' not in s:
        continue
    old=s
    for label,(name,path) in icons.items():
        if label in s:
            svg=f'<span class="nav-icon nav-icon-{name}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{path}</svg></span><span>{label.split(" ",1)[1]}</span>'
            s=s.replace(label, svg)
    if s!=old:
        p.write_text(s,encoding='utf-8')
