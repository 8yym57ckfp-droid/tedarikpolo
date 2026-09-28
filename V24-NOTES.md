# Safepays v24

Finance queue redesign. Investment and withdrawal requests remain **manual admin approval only**.

Features:
- unified pending queue
- search by transaction ID / user / email / TX hash
- network and type filters
- pending deposit/withdrawal counters
- total pending amount
- transaction detail drawer
- explicit approve / reject confirmation
- audit decision through existing backend API
- approved deposits credit balance; approved withdrawals debit balance
- rejected requests do not change balance

No automatic blockchain approval is enabled in v24.
