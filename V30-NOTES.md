# Safepays v30

- Idempotency-Key / requestKey support for deposit and withdrawal creation.
- Transaction review locks with a short lock window.
- PostgreSQL row locking (`FOR UPDATE`) during admin decisions.
- Admin decision metadata: decisionBy and decisionAt.
- 30-minute pending expiry to `auto-rejected` for unprocessed requests.
- Reopen endpoint for rejected/auto-rejected requests.
- Expiry timestamps and lock state exposed to admin queue.
- Ledger updates remain transactional with the admin decision in PostgreSQL.
- Investment approval remains manual; there is no automatic blockchain crediting.
