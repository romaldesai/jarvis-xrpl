# AP4M proof: autonomous, bounded x402 payments (XRPL EVM testnet, chain 1449000)

Run on the **Mastercard AP4M hackathon platform** (`https://hackathon.ap4m.build`), Sun Oct 25 2026, ~12:50–1:00 AM ET.
Every hash below was re-read from `https://rpc.testnet.xrplevm.org` (`eth_getTransactionReceipt`).
**Independently re-verified Sun Oct 25 2026, 10:40 AM ET** (fresh clone, separate machine): across this file and
[`PROOF.md`](PROOF.md), 22 transactions status 1, 2 intentional reverts (own-ledger `OverCap` and the AP4M over-cap below),
8 hashes are IDs (merchant / channel / claim / digest), not transactions. All 3 AP4M receipts → `verify-receipt.mjs` **verified: true**,
0.25 RLUSD each. Re-run it yourself: `npm run verify:proof` (needs outbound access to the testnet RPC).
**Re-verified live Sun Oct 25 2026 ~11:05 AM ET** against `https://rpc.testnet.xrplevm.org`:
`npm run verify:proof` → `chain 1449000: 32 hashes -> 22 success, 2 reverted, 8 non-tx (IDs)`, both reverts the intentional
over-cap proofs, exit 0; `npm run decode:revert` → `VoucherExceedsChannelCap: requested 3.0 RLUSD > cap 2.0 RLUSD`
(name inferred from selector `0xeeaa063e`).
Explorer: `https://explorer.testnet.xrplevm.org/tx/<hash>`.

AP4M contracts (from `/public/config`): PaymentLedger `0xcAB42800A5ECF0D253Fa2581Bb3334B4DAEfaE91`,
ParticipantRegistry `0x4cF27435FE56161aa9b1cffdD87784aa68b7D1E8`, PooledEscrowVault `0x83DD9cD010eb46e96eceF8F7eB0a18f7845AaBC0`,
RLUSD `0x27b57a9D0b8d24EB97259c4E2279e45255e016f3` (**AP4M-provided testnet RLUSD**, not mainnet RLUSD).

**Who enforces what.** The **2 RLUSD channel cap** is enforced **on-chain by AP4M's PaymentLedger** (see the reverted
over-cap tx below). The merchant allowlist, 0.50 RLUSD price ceiling, 3-per-run velocity limit and kill switch are
**our agent's off-chain policy** (`ap4m/policy.mjs`), checked before anything is signed.

## CONTROL

| Item | Value | Status |
| --- | --- | --- |
| Team | RomsCoin, `active`, 20 RLUSD allocation, vault funded by organizer | portal `/public/participant/me` |
| Agent (KYA) | `0xcBcc8c442d312D2D2b4B3d124d268fC235294e2C`, agent_id `0xae6dce38…a8d80e` | registered through the AP4M service |
| Merchant (registered through the AP4M service) | payout `0xf9a20Cc9a8ea389D07B76A4176882e53fFED2A24`, merchant_id `0x010fc4f5c02c56ae77735904ec6212efb9256004ceb63771b520bf4c899a4f39`, tx `0x648c21c6a44edf0f903be75b6f5dfea854180cf2c056587cdb00094e987faff3` | status 1 | <!-- secret-scan:allow: public tx hashes / ids -->
| Channel (funded cap) | `0x2282fc58936acb028b69ff8709a801a918100fac14828404c8d5da5e37b06cbf`, cap **2 RLUSD** | open | <!-- secret-scan:allow: public tx hashes / ids -->

## PAY: three autonomous purchases (no human tap), 0.25 RLUSD each

The agent received HTTP 402, ran `policy.decide()` → `WITHIN_POLICY`, signed an EIP-712 Voucher locally, and got the quote back in the same round trip.

| # | Voucher redeemed (`VoucherRedeemed`) | RLUSD payout to merchant (`ClaimPaid`) | Settlement recorded | Receipt |
| --- | --- | --- | --- | --- |
| 1 | `0x6a64a7826c8737745fd01504591341c62987073410b3258d2e964054f620c2cd` | `0xedf543c168eaa67c0c83ecf8a70cd62bb66797b1cd4e5afc86cebdb66debcf36` | `0xcf1d7275d9cac23a631f6a78b9ef7395e2abe9a872db95fef37d1c440dccf268` | [claim 0x68d4…bfe4](https://hackathon.ap4m.build/public/evidence/claims/0x68d41ed33036995de7b1340e296e1ebaddd29546cd045cdcb408dfc09efbbfe4/0xb523e912184c31ccd3ad935b0549f5879dc894e86b7e4be8225a4df5e5ea18f0.json): `verify-receipt.mjs` → **verified: true** | <!-- secret-scan:allow: public tx hashes / ids -->
| 2 | `0x6e2c8cdca92b7a7560bfe604ff638e496fcdbb3d3d0d4d31c7c738110e93c033` | `0xdffda0c0558dec4c82cd33d7bf037c065d162b45f443988439f494e69568cb5c` | `0x49dba42a0d58e7b57da8a52f2ef98e660f5040b322887f2ee90d13feb26d0ebd` | [claim 0xaa43…7c7d](https://hackathon.ap4m.build/public/evidence/claims/0xaa4346fe78b815a533e3cbf48ee7b84fc86fb431bfa63f3351bdcc95d48b7c7d/0x517f57fbc62ea711bb2e416acc0686eee4ac59db10ca75a27ddeb5ddecef15e7.json) | <!-- secret-scan:allow: public tx hashes / ids -->
| 3 (stage-format rehearsal, 1:10 AM) | `0x1d4e5ae7c337dcc3882e29e88aa3138d78b1f17150ca6974af754df48981c3d9` | `0xbc1ed5c2a905c885bd328f2b24be39f8219e65b73ec12a0f1bc4bd48fd97a142` | `0x89c90f59f9b7d63e9bb70c78445ada5dbd746c596ad5f3c6298b861d8affaa89` | [claim 0xeb32…09ac](https://hackathon.ap4m.build/public/evidence/claims/0xeb32ca31dbc9b9473096d47a526c3bb0e0d441a457ca8d40ccaa4fbef79209ac/0x5865f34c7d680b9ea28479ad1d2e3058871537558e9ee627f58521833350f748.json) | <!-- secret-scan:allow: public tx hashes / ids -->

All nine transactions: status 1.

Quote bought: USD→INR 94.94 (Frankfurter/ECB reference rate). The agent then **prepared** the family remittance:
₹5,000 = $52.67 + $0.99 fee = $53.66 (≈ 53.66 RLUSD), status `AWAITING_HUMAN_APPROVAL`. The remittance is not sent without the user's tap.

> **Two different amounts, both correct.** **53.66 RLUSD** is this AP4M lane's *prepared, unsent* quote at rate **94.94**
> (Oct 25). **53.76 mRLUSD** in [`PROOF.md`](PROOF.md) is an *earlier, human-approved settlement* on **our own
> PaymentLedger with MockRLUSD** at rate **94.76** (Oct 24). Different runs, different FX rates, different ledgers.
> The remittance is not run on AP4M because our 20 RLUSD AP4M allocation is below the ~54 RLUSD it needs.

## REJECTED

| Attempt | Result |
| --- | --- |
| Over cap: Voucher for cumulative 3 RLUSD on a 2 RLUSD channel | policy: `CHANNEL_CAP: 0.5 + 2.5 > 2.0 RLUSD`; forced on-chain anyway → tx `0xc1ba1b65d864c9aa2b6102c6281b1475cccfa9f334f77c83a466ed3a47f9e388` **status 0 (reverted by AP4M's PaymentLedger)**; decoded below | <!-- secret-scan:allow: public tx hashes / ids -->
| Kill switch (`STOP` file present) | `KILL_SWITCH_ACTIVE`: nothing signed, nothing sent |
| Unknown merchant / price above 0.50 / velocity > 3 / fresh quote cached | refused in `policy.test.mjs` (9/9 pass) |

## Decoded over-cap revert

Replaying the reverted tx with `eth_call` at block − 1 returns custom-error data:

| Field | Value |
| --- | --- |
| Selector | `0xeeaa063e` |
| Args (uint256, uint256) | `3000000000000000000`, `2000000000000000000` → **requested 3.0 RLUSD vs cap 2.0 RLUSD** |
| Error name | `VoucherExceedsChannelCap(uint256,uint256)`: **inferred from a selector match** (`keccak256` of that signature starts with `0xeeaa063e`). AP4M does not publish the PaymentLedger ABI, so the name is not confirmed by AP4M. |

Re-verified live Sun Oct 25 2026 ~11:05 AM ET (output above). Reproduce (read-only, no keys, testnet only; refuses any chain other than 1449000): `npm run decode:revert`
(source: [`ap4m/decode-revert.mjs`](../ap4m/decode-revert.mjs), offline tests in `ap4m/decode-revert.test.mjs`).

## Spend

0.75 RLUSD paid out of a 2 RLUSD channel (20 RLUSD team allocation). Gas: 3 test XRP sent agent → merchant
for redemption gas (`0xf8c98c9f87c0208946e77b831982bdf96d3423989f52c7f9b6d40bdcf7d23c6d`, status 1). <!-- secret-scan:allow: public tx hashes / ids -->
Testnet only; UPI payout is simulated.
