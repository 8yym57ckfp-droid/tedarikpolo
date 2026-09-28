# Safepays v113
- Fixed re-login for newly registered accounts.
- Login now attempts `/api/auth/login` first, then falls back to local demo users.
- Supports registered-user stores from v109-v113.
- Logout clears the active demo current-user record so a stale Veysi Duman session cannot reappear.
- Registration stores static-demo users under `safepays_demo_registered_users_v113`.
