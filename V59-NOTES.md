# Safepays v59

- Sensitive bonus/reward changes now require the logged-in admin's 6-digit Google Authenticator / TOTP-style 2FA confirmation before saving.
- Bonus settings save and reset are protected.
- Event creation/editing (including reward amount) is protected.
- Protected changes write a local audit record under `safepays_sensitive_changes_v59`.
- If the current admin account has 2FA disabled, the sensitive save is blocked until 2FA is enabled.
- Current project remains a demo/static front-end; the existing demo account stores a verification code locally. Production security must move verification and audit enforcement to a real backend.
