# Safepays v94

- Mobile navigation active state now follows the current page; Cüzdan no longer highlights Ana Sayfa.
- Live Support is visible as the fifth mobile navigation item.
- Wallet page no longer exposes TRC20/ERC20 deposit addresses directly. It links to the staged deposit flow.
- Deposit flow: amount + network -> reveal address -> 20 minute timer -> Ödemeyi Yaptım -> pending request is written to shared demo transaction storage for admin requests panel.
- Added SafepaysDemo.createDepositRequest for manual payment confirmation without requiring a TX hash.
- Dashboard header/wallet pill compacted further.
