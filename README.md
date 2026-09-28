# Safepays v29

Bakiye ledger / muhasebe katmanı eklendi. Her onaylanan yatırım veya çekim, bakiye öncesi/sonrası ve kaynak işlem IDsi ile ledger kaydı oluşturur.

## Demo
User: test@safepays.local / 12345678
Admin: admin@safepays.local / Admin123!

## Çalıştırma
```bash
npm start
```
Ledger kullanıcı: `/balance-history.html`
Ledger admin: `/admin/ledger.html`

Gerçek finansal kullanım öncesi PostgreSQL, transaction isolation, idempotency, gerçek 2FA, secrets management ve bağımsız güvenlik denetimi gerekir.


## v42
- Admin wallet address management for TRC20/ERC20.
- User pending transactions show 30-minute countdown and automatic rejection demo.


## v43 wallet routing
- Multi-address TRC20/ERC20 wallet table with active/passive state.
- Round-robin assignment for new deposits.
- Per-address and per-member financial summaries.
