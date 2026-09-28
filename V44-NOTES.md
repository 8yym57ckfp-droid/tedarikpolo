# Safepays v44
- Persistent user dark theme across all user pages using localStorage key safepays-theme.
- Added dark theme styling for user app and admin panel.
- Admin panel has persistent theme toggle.
- Added team admin accounts with individual login, roles, password, email, and demo 2FA settings.
- Added admin Profileim page to change email, password, 2FA toggle and demo 2FA code.
- Demo accounts: admin@safepays.local/Admin123! (2FA 123456), finance@safepays.local/Finance123! (2FA 123456), support@safepays.local/Support123!, content@safepays.local/Content123!.
- This remains a static/localStorage demo; production auth must be server-side with secure password hashing, real TOTP, sessions, RBAC, recovery, audit logs and database storage.
