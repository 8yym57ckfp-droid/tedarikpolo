# Safepays v119

Fixed account identity leakage on shared member headers. The Events page and other member pages now read the logged-in user from `safepays_demo_current_user` and update the header avatar initials and wallet balance. A newly registered account no longer shows Veysi Duman / 12,480 USDT in the Events header.
