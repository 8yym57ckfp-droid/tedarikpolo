# Safepays v29 API

## Ledger
- `GET /api/ledger` — giriş yapan kullanıcının bakiye hareketleri.
- `GET /api/admin/ledger?userId=USR-10001` — admin ledger sorgusu.

Ledger kayıtları: `balanceBefore`, `balanceAfter`, `direction`, `amount`, `reason`, `transactionId`, `createdAt`.
