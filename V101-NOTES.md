# Safepays v101

## Yatır / Çek overview redesign
- Rebuilt `finance.html` as a compact overview rather than exposing deposit wallet addresses directly.
- Added dashboard-style Safe Pays header with wallet balance and VD profile control.
- Added Yatır / Çek mode switch.
- Deposit mode provides QR/deposit-flow entry points; addresses are not displayed on this overview.
- Withdraw mode provides withdrawal-flow and history entry points.
- Added quick actions, campaign banner, recent transactions, and security note.
- Preserved existing `deposit.html`, `withdraw.html`, demo store, admin data, and transaction workflow.
- Mobile bottom navigation uses 5 items with Yatır / Çek active.
