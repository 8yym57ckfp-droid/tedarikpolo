# SafePays — sistem haritası (kullanıcı referansı)

Kaynak: kullanıcının ChatGPT üzerinden çıkardığı mimari özet. Referans amaçlı; kod gerçeğiyle çelişirse kod + kullanıcı onayı önceliklidir.

## Omurga

Üye işlem başlatır → ağ → uygun aktif cüzdan → wallet.teamId → ekip finans/teminat → transaction → admin/ekip → bakiye/kasa/komisyon/istatistik → audit.

## Kritik köprüler

- USER ↔ TRANSACTION
- WALLET → TEAM
- TRANSACTION → TEAM / USER
- TEAM → FINANCE / WALLET / POOL
- ADMIN → TX
- OWNER → TEAM / WALLET / FINANCE

## Notlar

- Mevcut yapı ağırlıklı localStorage demo; production için tek backend DB hedefi haritada belirtilmiş.
- Public landing (`index.html`) pazarlama kabuğudur; üye paneli (`dashboard.html` vb.), admin ve owner sayfalarından stil olarak `body.public-landing` ile ayrılır.
- Landing mockup referansı: `docs/landing-mockup-reference.png` (koyu navy, neon cyan, cam kartlar).
