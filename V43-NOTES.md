# Safepays v43

- Admin wallet management changed from one address per network to a multi-address table.
- Multiple TRC20/ERC20 deposit addresses can be added, edited, activated/deactivated, or deleted.
- New deposits rotate round-robin across active addresses per network; each new deposit consumes the next active address once before cycling.
- Deposit records store the actual receiving wallet address and wallet ID.
- Admin wallet table shows use count, approved incoming deposit volume, approved outgoing volume matching that address, net, and last use.
- Admin dashboard includes member-level approved deposit/paid withdrawal summary.
- Existing legacy deposits without an address are assigned to the first active address for reporting compatibility without increasing its usage count.
- Demo/static localStorage only; not production custody or shared backend.
