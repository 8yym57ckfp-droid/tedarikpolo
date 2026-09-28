# V245 — Owner withdrawal pool UI fix

- Fixed Owner/Admin sidebar collapsing horizontally because global `nav{display:flex;height:72px}` rules leaked into `.admin-nav`.
- Added explicit sidebar nav reset rules so the menu stays vertical on all Owner/Admin pages.
- Added Owner withdrawal-pool visibility for investment wallet rotation: TRC20/ERC20 active wallet lists, team assignment, queue position, usage count, and next wallet marker.
- Added a dashboard stat showing the next wallet/team in the investment rotation.
- Kept existing round-robin sequence state; the new panel reads the same sequence used by `reserveNextWalletAddress()`.
- Enlarged network identity badges in the withdrawal pool.
