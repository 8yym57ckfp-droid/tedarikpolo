# SafePays v177 — Controlled recovery from v166.16

Base: v166.16 working package. Changes are limited to the post-v166 requests recorded by the user.

- v167: pending request table-only auto-refresh with configurable seconds.
- v168: removed visible team risk/guarantee bar from finance overview.
- v169: reports page uses the shared dark theme.
- v170: removed Members category from staff/admin navigation.
- v171: Owner member operations route is Owner-specific.
- v172: per-team owner lock/self-reactivation behavior and locked team profile fields.
- v173: finance KPIs and reconciliation accounting cards.
- v174: wallet/team isolation and automatic team scoping; no manual team dropdown.
- v175: support category -> chat flow with topic back button.
- Additional hardening: passive team login blocked, owner member page backend/local fallback, fixed broken content script seed syntax, corrected dark-theme asset paths, and smoke-tested JavaScript/store/link serving.

The existing v166.16 working files outside these targeted areas were preserved.
