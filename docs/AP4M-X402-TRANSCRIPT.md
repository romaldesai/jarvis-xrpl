# AP4M x402 transcript: what the agent actually did

This document shows the HTTP 402 → pay → retry exchange behind the three autonomous AP4M purchases. Every hash was re-checked against the public XRPL EVM testnet RPC (`https://rpc.testnet.xrplevm.org`, chain 1449000) on Sun Oct 25 2026, about 11:20 AM ET.

Scope, stated plainly:
- AP4M paid for **three 0.25 RLUSD corridor-quote purchases** (AP4M-provided testnet RLUSD). It did **not** pay for the ₹5,000 family remittance.
- The remittance needs a human tap and runs on our own PaymentLedger with MockRLUSD (see `docs/PROOF.md`).
- The UPI payout is **simulated**.

## 1. The 402 challenge (live capture, no payment made)

This is a plain `GET` to the Corridor Quote Merchant (`ap4m/merchant.mjs`, built on the AP4M SDK's `createX402Merchant`). No voucher was signed and nothing was spent. Captured Sun Oct 25 2026 15:17:43 GMT.

```
GET /resource HTTP/1.1
Host: 127.0.0.1:4308
X-AP4M-CHANNEL-ID: 0x2282fc58936acb028b69ff8709a801a918100fac14828404c8d5da5e37b06cbf

HTTP/1.1 402 Payment Required
Cache-Control: no-store, private
Vary: PAYMENT-SIGNATURE, X-AP4M-CHANNEL-ID
PAYMENT-REQUIRED: <base64, decoded below>
Content-Type: application/json

{"x402Version":2,"error":"payment_required"}
```

Decoded `PAYMENT-REQUIRED` header:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "http://127.0.0.1:4308/resource", "mimeType": "application/json", "description": "AP4M hackathon resource" },
  "accepts": [{
    "scheme": "batch-settlement",
    "network": "eip155:1449000",
    "asset": "0x27b57a9D0b8d24EB97259c4E2279e45255e016f3",
    "amount": "250000000000000000",
    "payTo": "0xf9a20Cc9a8ea389D07B76A4176882e53fFED2A24",
    "maxTimeoutSeconds": 300,
    "extra": {
      "channelId": "0x2282fc58936acb028b69ff8709a801a918100fac14828404c8d5da5e37b06cbf",
      "ledger": "0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91",
      "acceptedCumulativeAmount": "750000000000000000",
      "pricingMode": "fixed",
      "bindingVersion": "1"
    }
  }]
}
```

Fields worth noting:
- `amount` = 0.25 RLUSD.
- `network` is testnet 1449000.
- `payTo` is our registered merchant payout.
- `acceptedCumulativeAmount` = 0.75 RLUSD. That is the channel's redeemed total after the three purchases below, as recorded by the merchant's view of the AP4M channel.

## 2. Agent flow per purchase (from `ap4m/out/audit.jsonl`)

The agent's audit log is local and gitignored. The event names below are copied from it, timestamps in UTC. It contains no keys.

1. `http_402_received`: the merchant answered 402 with a price of 0.25 RLUSD.
2. `policy_decision`: app-level policy checks run before signing:
   - merchant allowlist
   - 0.50 RLUSD price ceiling
   - channel headroom
   - 3 buys per run
   - kill switch file `STOP`
3. `voucher_signed_and_redeemed`: the SDK `buyResource()` signs an EIP-712 voucher and retries the request with `PAYMENT-SIGNATURE`. The merchant redeems the voucher on AP4M's PaymentLedger.
4. `rlusd_settled_to_merchant`: the AP4M service pays out from the vault and settles. A public claim receipt is issued.
5. `remittance_prepared_awaiting_user_tap`: the ₹5,000 transfer is only prepared. Status `AWAITING_HUMAN_APPROVAL`.

### Purchase 1, including a real failure and a safe resume

```
04:53:21Z http_402_received      price 0.25, channel used 0.0 of 2.0
04:53:21Z policy_decision        allow=true WITHIN_POLICY
04:53:37Z error                  purchase outcome unavailable (HTTP 503); resume the same operation
04:53:51Z error                  expected HTTP 402 from merchant, got 409   (see note below)
04:54:04Z resuming_unfinished_purchase  operation quote-1792904001343
04:54:05Z voucher_signed_and_redeemed   claim 0x68d41e…bfe4
04:54:05Z rlusd_settled_to_merchant     0.25 RLUSD
04:54:05Z remittance_prepared_awaiting_user_tap  ₹5,000 @ 94.94 = $52.67 + $0.99 = 53.66, AWAITING_HUMAN_APPROVAL
```

About the 409: the SDK merchant (`ap4m/ap4m-x402.mjs`) answers 409 `retry_retained_payment` when the channel still has an incomplete payment. That matches what happened here, although the audit line did not record the response body.

The SDK stores the signed payment intent *before* sending it. After the 503, the agent resumed the **same** operation instead of signing a second voucher, so there was no double payment. Only one claim exists for purchase 1.

### Purchase 2 (503 retried automatically)

```
04:54:22Z http_402_received      price 0.25, channel used 0.25 of 2.0
04:54:22Z policy_decision        allow=true WITHIN_POLICY
04:54:36Z merchant_busy_retrying attempt 1 (HTTP 503)
04:54:43Z voucher_signed_and_redeemed   claim 0xaa4346…7c7d
04:54:55Z rlusd_settled_to_merchant     0.25 RLUSD
```

### Over-cap attempt and kill switch

```
04:55:01Z overcap_policy_decision  allow=false CHANNEL_CAP: 0.5 + 2.5 > 2.0 RLUSD
04:55:14Z overcap_onchain_attempt  forced on-chain anyway: cumulative 3.0 vs cap 2.0 → status 0 (reverted)
04:55:15Z KILL_SWITCH_ACTIVE       ./STOP present → agent refuses to run
```

### Purchase 3 (clean)

```
05:01:32Z http_402_received      price 0.25, channel used 0.5 of 2.0
05:01:32Z policy_decision        allow=true WITHIN_POLICY
05:01:55Z voucher_signed_and_redeemed   claim 0xeb32ca…09ac
05:02:10Z rlusd_settled_to_merchant     0.25 RLUSD
```

## 3. Claim → transaction → receipt map (all re-verified on-chain)

- Ledger = AP4M PaymentLedger `0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91`.
- Vault = `0x83DD9cD010eb46e96eceF8F7eB0a18f7845AaBC0`.
- Status 1 = success.
- Receipt base: `https://hackathon.ap4m.build/public/evidence/claims/<claim>/<digest>.json`.

| # | Step | Tx hash | Status | Block | Contract |
|---|---|---|---|---|---|
| 1 | redeem | `0x6a64a7826c8737745fd01504591341c62987073410b3258d2e964054f620c2cd` | 1 | 9228956 | Ledger |
| 1 | vault payout | `0xedf543c168eaa67c0c83ecf8a70cd62bb66797b1cd4e5afc86cebdb66debcf36` | 1 | 9228959 | Vault |
| 1 | settle | `0xcf1d7275d9cac23a631f6a78b9ef7395e2abe9a872db95fef37d1c440dccf268` | 1 | 9228960 | Ledger |
| 2 | redeem | `0x6e2c8cdca92b7a7560bfe604ff638e496fcdbb3d3d0d4d31c7c738110e93c033` | 1 | 9228966 | Ledger |
| 2 | vault payout | `0xdffda0c0558dec4c82cd33d7bf037c065d162b45f443988439f494e69568cb5c` | 1 | 9228967 | Vault |
| 2 | settle | `0x49dba42a0d58e7b57da8a52f2ef98e660f5040b322887f2ee90d13feb26d0ebd` | 1 | 9228968 | Ledger |
| — | **over-cap voucher** | `0xc1ba1b65d864c9aa2b6102c6281b1475cccfa9f334f77c83a466ed3a47f9e388` | **0** | 9228973 | Ledger |
| 3 | redeem | `0x1d4e5ae7c337dcc3882e29e88aa3138d78b1f17150ca6974af754df48981c3d9` | 1 | 9229041 | Ledger |
| 3 | vault payout | `0xbc1ed5c2a905c885bd328f2b24be39f8219e65b73ec12a0f1bc4bd48fd97a142` | 1 | 9229042 | Vault |
| 3 | settle | `0x89c90f59f9b7d63e9bb70c78445ada5dbd746c596ad5f3c6298b861d8affaa89` | 1 | 9229043 | Ledger |

| # | Claim ID | Receipt digest | Receipt `settlementEvidence.status` | `cumulativeDisbursed` |
|---|---|---|---|---|
| 1 | `0x68d41ed33036995de7b1340e296e1ebaddd29546cd045cdcb408dfc09efbbfe4` | `0xb523e912184c31ccd3ad935b0549f5879dc894e86b7e4be8225a4df5e5ea18f0` | settled | 0.25 |
| 2 | `0xaa4346fe78b815a533e3cbf48ee7b84fc86fb431bfa63f3351bdcc95d48b7c7d` | `0x517f57fbc62ea711bb2e416acc0686eee4ac59db10ca75a27ddeb5ddecef15e7` | settled | 0.50 |
| 3 | `0xeb32ca31dbc9b9473096d47a526c3bb0e0d441a457ca8d40ccaa4fbef79209ac` | `0x5865f34c7d680b9ea28479ad1d2e3058871537558e9ee627f58521833350f748` | settled | 0.75 |

All three receipts use schema `ap4m.claim-receipt.v1`, and the AP4M SDK's receipt verifier reports `verified: true` for each (`node ap4m/verify-receipt.mjs <receiptURL>`). Cumulative disbursement steps 0.25 → 0.50 → 0.75, which matches `acceptedCumulativeAmount` in the live 402 above.

## 4. Over-cap revert, raw data

- The tx is a call to the Ledger, selector `0x21eb2efb` (the same selector as the successful redeems).
- Status 0, block 9228973, gasUsed 150000 of 300000.
- Re-executing the same call with `eth_call` at block 9228972 returns:

```
0xeeaa063e
  00000000000000000000000000000000000000000000000029a2241af62c0000   = 3000000000000000000 (3.0 RLUSD, attempted cumulative)
  0000000000000000000000000000000000000000000000001bc16d674ec80000   = 2000000000000000000 (2.0 RLUSD, channel cap)
```

The error **name** `VoucherExceedsChannelCap(uint256,uint256)` is our inference from the selector and arguments. AP4M does not publish the ledger ABI, so treat the name as unconfirmed and the raw selector and arguments as the fact. You can reproduce this with `npm run decode:revert`.

## 5. Which controls are enforced where

| Control | Where enforced | Evidence |
|---|---|---|
| 2 RLUSD channel cap | **On-chain, by AP4M's PaymentLedger** | revert above |
| Merchant allowlist, 0.50 price ceiling, 3 buys per run, kill switch | App-level, in our agent (`ap4m/policy.mjs`) before signing | `policy_decision` / `overcap_policy_decision` / `KILL_SWITCH_ACTIVE` events; `ap4m/policy.test.mjs` |
| Human approval for the ₹5,000 remittance and the ₹ limits | App-level, on our own PaymentLedger flow | `docs/PROOF.md` |
| Audit trail | Local JSONL file (not tamper-evident) | known gap |

Known gaps:
- One key is used as admin, signer and relayer.
- The web API is localhost-only and has no auth.
- The audit log is a local file.
- The UPI payout is simulated.
