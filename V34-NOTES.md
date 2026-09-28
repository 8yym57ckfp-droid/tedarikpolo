# Safepays v34

Fix: User login stored the API token under `safepays_api_token`, while deposit/withdraw/security/ledger pages were reading the old `safepays_token` key. This caused authenticated investment and withdrawal requests to be sent without a valid Bearer token.

All affected user pages now use the same `safepays_api_token` key.

Investment and withdrawal requests remain manual-admin approval workflows. No automatic investment crediting was added.
