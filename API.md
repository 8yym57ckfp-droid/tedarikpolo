# Safepays v29 API

## Portal sign-in and separation
- Member accounts sign in at `/login.html` and use bearer-token authentication.
- The Owner signs in at `/owner/login.html` using `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_TOTP_SECRET`.
- The Admin team signs in at `/admin/login.html` using the separate `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD`, and `TEAM_ADMIN_TOTP_SECRET` values.
- Owner and Admin use separate HTTP-only session cookies. `/api/owner/me` and `/api/admin/me` verify only their matching portal session. An authenticated Admin is redirected away from every `/owner/*.html` route, including `/owner/login.html`; Owner sessions are likewise redirected away from `/admin/*.html` routes.
- Both management roles can use day-to-day transaction operations. Content, maintenance, member security, wallet-address changes, and rate changes require the Owner session. Admin credentials must differ from Owner credentials.

## Ledger
- `GET /api/ledger` — giriş yapan kullanıcının bakiye hareketleri.
- `GET /api/admin/ledger?userId=USR-10001` — admin ledger sorgusu.

Ledger kayıtları: `balanceBefore`, `balanceAfter`, `direction`, `amount`, `reason`, `transactionId`, `createdAt`.
