# SafePays v244

- Member investment/withdrawal pages use a deep navy theme; purple accents replaced with blue.
- Investment flow asks for explicit confirmation before reserving/showing a payment wallet.
- TRC20/ERC20 remain selectable and network icons are preserved.
- Active team wallets rotate round-robin per network through the existing wallet router; inactive/ineligible teams are skipped.
- A shared 2-minute cooldown prevents consecutive investment/withdrawal requests per member.
- Cooldown is enforced in demo-store and server API routes.
- Withdraw page shows a live cooldown countdown and disables the submit button.
