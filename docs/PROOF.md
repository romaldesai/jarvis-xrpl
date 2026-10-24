# XRP2India: on-chain proof (XRPL EVM Sidechain testnet, chain 1449000)

Generated 2026-10-24T17:28:08.211Z by `npm run proof`. Public data only.

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

Voucher for cap + 1 base unit, mined and reverted with `OverCap` (status 0): [`0x059983ece4…45765d`](https://explorer.testnet.xrplevm.org/tx/0x059983ece48d034396c5bbb4ffc0c95e23b788c6f1c06f66fd5259af4945765d)

## Payments (from audit.jsonl)

_No testnet payments yet. Run `npm run demo:headless`._
