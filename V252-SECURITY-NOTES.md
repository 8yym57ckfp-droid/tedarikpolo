# SafePays V252 Security Hardening

- Owner/Super Admin login now authenticates against `/api/admin/login` with server-side credentials and 2FA before entering the Owner panel.
- Admin authentication is stored in an HttpOnly `sp_admin_session` cookie; frontend JavaScript no longer receives the bearer token.
- Owner pages verify `/api/admin/me` before rendering protected content.
- Logout invalidates the server session and clears the HttpOnly cookie.
- Demo credentials were removed from Owner/Admin login UI.
- Production TOTP must be supplied with `ADMIN_TOTP_SECRET`; local development can use `ADMIN_TOTP_CODE`.
- Owner backend calls use the authenticated cookie session.

## Important remaining migration

Team account CRUD/login is still backed by the legacy browser-side SafeAdmin store in this release. It must be migrated to server-side account storage/RBAC before real-money production use.
