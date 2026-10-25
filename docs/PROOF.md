# XRP2India: on-chain proof (XRPL EVM Sidechain testnet, chain 1449000)

Generated 2026-10-24T17:52:52.842Z by `npm run proof`. Public data only.

> **Scope:** this file is the **human-approved ₹5,000 remittance on our own PaymentLedger with MockRLUSD (mRLUSD)**,
> not the AP4M platform. Each payment below is **$53.76 = 53.76 mRLUSD** at rate **94.76** (Oct 24). The AP4M lane's
> 53.66 RLUSD figure is a different run at rate 94.94; see [`AP4M-PROOF.md`](AP4M-PROOF.md). Independently re-verified
> Sun Oct 25 2026, 10:40 AM ET (`npm run verify:proof`).

## Contracts

| Contract | Address |
| --- | --- |
| MockRLUSD (18dp, labelled "mock RLUSD") | [`0x9fE486cB9d1ed61e8deC50423c33054133f569de`](https://explorer.testnet.xrplevm.org/address/0x9fE486cB9d1ed61e8deC50423c33054133f569de) |
| ParticipantRegistry (KYA) | [`0x980468f18bAfc7D8351a3dE8D6cc84Fef7fEb2D4`](https://explorer.testnet.xrplevm.org/address/0x980468f18bAfc7D8351a3dE8D6cc84Fef7fEb2D4) |
| PaymentLedger | [`0xe9E73c50d8D7f1a6e890930A09158824DCd4B688`](https://explorer.testnet.xrplevm.org/address/0xe9E73c50d8D7f1a6e890930A09158824DCd4B688) |
| Agent (KYA-registered) | [`0x6729586b5077F233e99f3B64E0648C5719260593`](https://explorer.testnet.xrplevm.org/address/0x6729586b5077F233e99f3B64E0648C5719260593) |
| Payout (bound in registry) | [`0xE94ffe05A1fCe8959739Fd90A89a868FbD3E5b13`](https://explorer.testnet.xrplevm.org/address/0xE94ffe05A1fCe8959739Fd90A89a868FbD3E5b13) |
| Channel funder | [`0x6729586b5077F233e99f3B64E0648C5719260593`](https://explorer.testnet.xrplevm.org/address/0x6729586b5077F233e99f3B64E0648C5719260593) |

Channel #1 cap: 500.0 mock RLUSD

## Setup transactions

| Step | Tx |
| --- | --- |
| deployMockRLUSD | [`0x3a9734af9d…f78361`](https://explorer.testnet.xrplevm.org/tx/0x3a9734af9dabff64ed22c5f004be3b95f3b7e7e1b9fbaf93ae78b4838af78361) |
| deployRegistry | [`0xf0af35331e…90205a`](https://explorer.testnet.xrplevm.org/tx/0xf0af35331e9c3b49b3020f7aec126767fe1c8ec34a5a8bcc7c825affe890205a) |
| deployLedger | [`0x7fc5ae6af9…df6064`](https://explorer.testnet.xrplevm.org/tx/0x7fc5ae6af954130cb82156c0a77113ac720a2926ffeb0c9a591556d911df6064) |
| kyaRegister | [`0x81fa556df5…4a7a7d`](https://explorer.testnet.xrplevm.org/tx/0x81fa556df5205a1474b939edddb72e9a7a5fea85810c8ad379ea7c35884a7a7d) |
| openChannel | [`0x8baf5fc933…fb2e8c`](https://explorer.testnet.xrplevm.org/tx/0x8baf5fc933f94871ce831e8f29a11558070915a6a89efdd8fcc9497e56fb2e8c) |

## REJECTED on-chain: over-cap redeem

Voucher for cap + 1 base unit, mined and reverted with `OverCap` (status 0): [`0x20b146d6cf…ef633b`](https://explorer.testnet.xrplevm.org/tx/0x20b146d6cf4a7e432844f99748c0643134e93ab8640bac9312ad485c3fef633b)

## Payments (from audit.jsonl)

| Time (UTC) | Step | Amount | Tx |
| --- | --- | --- | --- |
| 2026-10-24 17:32:01 | redeemVoucher | $53.76 | [`0x571f3d57c1…c1e20a`](https://explorer.testnet.xrplevm.org/tx/0x571f3d57c11a1ac3171a0e8e45d840c4ca0b431d17f5c4341fbe9b9f1fc1e20a) |
| 2026-10-24 17:32:07 | settle | $53.76 | [`0x14acb6f6cc…330593`](https://explorer.testnet.xrplevm.org/tx/0x14acb6f6cc3a04fbf393637fef41a77aafa3b280b97bbe833ddf34d23d330593) |
| 2026-10-24 17:46:30 | redeemVoucher | $53.76 | [`0x8d13c5088b…fd96d5`](https://explorer.testnet.xrplevm.org/tx/0x8d13c5088b95955b65b1c19e0b05edc1b141827187c5d73d84cc25f230fd96d5) |
| 2026-10-24 17:46:33 | settle | $53.76 | [`0x7d4460e4a4…d42396`](https://explorer.testnet.xrplevm.org/tx/0x7d4460e4a4fb3e760c1aa1b9d831d6c3787efcfbc2d99aef19be1f42b3d42396) |
| 2026-10-24 17:47:04 | redeemVoucher | $53.76 | [`0x32629908a3…5f7903`](https://explorer.testnet.xrplevm.org/tx/0x32629908a304e9de82d600471459d9b6c7a4e1d7115c1a28db986e81d05f7903) |
| 2026-10-24 17:47:09 | settle | $53.76 | [`0x0c3b29f999…2a2dd8`](https://explorer.testnet.xrplevm.org/tx/0x0c3b29f9996e28598ad84a32d7b9d3ba211f3bd609589e3b1f9d8ea74a2a2dd8) |

## REJECTED by policy (latest)

| Time (UTC) | Rule | Reason |
| --- | --- | --- |
| 2026-10-24 17:32:07 | `PER_TX_CAP` | $528.64 is over the per-payment cap of $100.00 |
| 2026-10-24 17:32:07 | `RECIPIENT_NOT_ALLOWED` | "landlord" is not on the allow-list |
| 2026-10-24 17:32:07 | `KILL_SWITCH` | Kill switch is ON: all payments are blocked |
