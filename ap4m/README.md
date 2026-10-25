# XRP2India × AP4M: bounded autonomous payments

The family remittance (₹5,000 to Mom) **always** waits for a human tap. But a remittance agent also needs small
things to do its job, like a fresh USD→INR corridor quote. Asking the user to approve a 25-cent data purchase
would be absurd, so this lane lets the agent **decide and pay by itself**, on the **real Mastercard AP4M
platform**, inside limits it cannot exceed:

| Control | Where it's enforced |
| --- | --- |
| Known agent (KYA) | Agent `0xcBcc…4e2C`, registered through the AP4M service (participant portal → AP4M `ParticipantRegistry`) |
| Known merchant | Our Corridor Quote Merchant, registered through the AP4M service (`merchant_id 0x010f…4f39`, payout `0xf9a2…2A24`) |
| Funded spend limit | AP4M channel with a **2 RLUSD cap** (AP4M-provided testnet RLUSD), **enforced on-chain by AP4M's `PaymentLedger`**: a forced over-cap voucher reverted with `0xeeaa063e` (3.0 requested vs 2.0 cap) |
| Policy (our plain code, off-chain) | `policy.mjs`: merchant allowlist, 0.50 RLUSD price ceiling, channel cap, 3 purchases/run, quote freshness |
| Kill switch | `touch ap4m/STOP` and the agent refuses before signing anything |
| Audit | Every decision appended to `out/audit.jsonl` |
| Proof | Each payment has an AP4M `ap4m.claim-receipt.v1` receipt verifiable against the chain (`verify-receipt.mjs`) |

## Flow (x402, one HTTP round trip)

```
Agent                                Corridor Quote Merchant              AP4M / XRPL EVM testnet
  GET /resource  ───────────────────▶  402 PAYMENT-REQUIRED (0.25 RLUSD)
  policy.decide() → WITHIN_POLICY
  sign EIP-712 Voucher (local key)
  GET /resource + PAYMENT-SIGNATURE ▶  redeemVoucher() ───────────────────▶ VoucherRedeemed
  ◀──────────────── 200 quote + PAYMENT-RESPONSE
  record-redemption + settle  ─────────────────────────────────────────────▶ ClaimPaid → RLUSD to payout
                                                                            SettlementRecorded + receipt
  use quote to PREPARE ₹5,000 remittance → status AWAITING_HUMAN_APPROVAL
```

## Run it

Requires Node.js ≥ 22.13 (the AP4M x402 helper uses `node:sqlite`).

```bash
cd ap4m
npm install
cp .env.example .env      # fill in test-only keys locally; never commit .env
npm test                  # 9 policy + 6 decode tests, no network (root `npm test` also runs them on Node ≥ 22.13)
npm run merchant          # terminal 1: Corridor Quote Merchant on 127.0.0.1:4308
npm run agent             # terminal 2: agent buys a quote autonomously, settles, prints receipt
npm run overcap           # agent tries to exceed the cap: policy refuses, ledger reverts on-chain
touch STOP && npm run agent; rm STOP   # kill switch demo
npm run verify -- <receipt_url>        # independent receipt verification
node decode-revert.mjs                 # decode the over-cap revert (eth_call at block-1, testnet only, no keys)
```

The agent reuses the open channel, so a live demo costs 0.25 RLUSD per run out of the 2 RLUSD cap.

## Files

- `agent.mjs` - autonomous buyer (sign in, channel, 402 probe, policy, x402 purchase, settle, remittance draft)
- `merchant.mjs` - x402 seller of a live USD→INR reference quote (Frankfurter/ECB; UPI payout is simulated)
- `policy.mjs` / `policy.test.mjs` - spend policy and tests
- `overcap.mjs` - on-chain over-cap rejection proof
- `decode-revert.mjs` / `decode-revert.test.mjs` - decodes that revert; the error name is inferred from a selector match because AP4M does not publish the PaymentLedger ABI
- `ap4m-x402.mjs`, `ap4m-hackathon-sdk.cjs`, `verify-receipt.mjs` - Mastercard AP4M hackathon SDK helpers (hackathon use only)

Proof with transaction hashes: [`docs/AP4M-PROOF.md`](../docs/AP4M-PROOF.md).
