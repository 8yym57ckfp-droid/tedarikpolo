# Safepays v36

- Fixed the actual blocker found in v35: `server/server.js` imported `pg` unconditionally, so `npm start` failed with `Cannot find module 'pg'` on a clean machine.
- PostgreSQL is now optional. If `pg` is installed and `USE_POSTGRES=true` with `DATABASE_URL`, PostgreSQL mode is used; otherwise the bundled local JSON demo database is used.
- Deposit and withdrawal request endpoints remain repeatable: every new request gets a unique DP-/WD- transaction ID, while a repeated request key is idempotent.
- Manual admin approval remains required; no automatic deposit crediting was added.
