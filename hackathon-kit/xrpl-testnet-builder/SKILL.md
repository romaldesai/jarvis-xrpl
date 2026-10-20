---
name: xrpl-testnet-builder
description: Rules, checklists and test strategy for building guardrailed-payment features on the XRPL testnet with xrpl.js (wallet funding, Payment, conditional escrow, SetRegularKey, verifying results, retries). Use when writing or reviewing any code that signs or submits XRPL transactions. Generic guidance only; contains no keys and no feature code.
---

# XRPL testnet builder

Guidance for the builder (Claude Code) while the hackathon clock is running. It is deliberately
generic: it says *how to be careful*, not *what to build*. Anything marked **VERIFY** must be
checked against xrpl.org (or the "Verified facts" table at the bottom, filled in by the researcher)
before it is relied on. Training-data memory of XRPL details is a starting point, never a source.

## Hard rules

1. **Testnet only.** The only network URL in code, config and docs is the testnet. Never put a
   mainnet URL anywhere, not even as a comment or a default.
2. **Secrets come from the environment.** Seeds and keys are read from `.env` (gitignored) at
   start-up, held in memory, and never logged, printed, written to the audit log, put in an error
   message, or returned from any API/tool. Public addresses are fine to log.
3. **The LLM only submits intents.** The policy engine is plain code outside the model. The model
   never sees a seed, never builds a transaction, never decides whether a rule applies, and its
   output is untrusted input that the policy validates like any other.
4. **Amounts are integers.** XRP amounts are drops, kept as strings at the edge and `BigInt` in
   the policy. No floating point anywhere near money. Reject anything that is not a positive
   integer string within bounds.
5. **Fail closed.** If the policy cannot decide (missing config, unreadable audit state, unknown
   field), the answer is "block", and the reason is logged.
6. **A transaction is not done when it is submitted.** It is done when the validated result says
   success. Check the final result code in the validated transaction metadata, not only the
   preliminary engine result.
7. **Every decision is audited**, including blocks and failures: timestamp, intent id, rule hit,
   reason, decision, tx hash if any. Append-only JSONL, no secrets, no personal data.
8. **One feature, live over slides.** Prefer a working testnet transaction over a polished
   abstraction. Check the cut list before adding anything.

## Client lifecycle

- One shared client per process. Connect on start, disconnect on shutdown, and keep a simple
  health check (a cheap server-info style call) before a demo run.
- Set explicit connect and request timeouts. Reconnect with capped exponential backoff and jitter.
- Keep the adapter behind a small interface (pay, escrow create/finish/cancel, set regular key,
  balance, lookup transaction). The real implementation uses the library; tests use a fake.
  Policy code never imports the library.

## Wallet funding (testnet)

- Wallets are generated and funded **during the build window** from the testnet faucet, never
  before, and never committed. Their seeds live only in a local `.env`.
- The faucet is rate-limited and sometimes slow or down. Fund the few wallets needed once, reuse
  them for every run, and record only public addresses in docs.
- Keep a spare funded wallet in reserve. If the faucet fails mid-demo, switch to the spare.
- Verify funding by reading the account balance, not by trusting the faucet response.

## Submitting and verifying a transaction

- Let the library fill sequence and fee, and always set a last-ledger bound so a stuck
  transaction expires instead of hanging.
- Wait for validation. Treat these separately: transport errors (retry the *lookup*), a rejected
  or failed result (do not blindly resubmit), and an unknown outcome (look the transaction up by
  hash before doing anything else).
- **Never double-pay.** Before retrying anything that moves value, check whether the first
  attempt actually landed (by hash, or by account history). Retries are only safe for reads and
  for submissions known not to have applied.
- Expect and handle: sequence errors, expired last-ledger, insufficient fee or reserve, queued
  results, "no permission", and "bad condition/fulfillment" classes of failure. **VERIFY** the exact
  result-code names and meanings against xrpl.org before writing the mapping.
- Show a human-readable summary plus the transaction hash and a link to a testnet explorer
  (**VERIFY** the explorer URL format). The hash is the proof the judges can open.

## Conditional escrow checklist (VERIFY every line)

- Fields needed to create a conditional escrow, and which time fields are required, optional or
  mutually constrained. Is a cancel time required? Is a finish-after allowed together with a
  condition?
- **Cancel semantics.** When can an escrow be cancelled, and by whom? A common trap: if "reject"
  maps to cancel, funds may not be returnable until a cancel-after time has passed. Decide how the
  demo shows the reject path given the real rules (for example a short cancel-after), and verify.
- Finish semantics: who may finish, what must be supplied (condition and fulfillment), and the
  **extra fee** that finishing a conditional escrow costs and how it scales with fulfillment size.
- Reserve and owner-count effects of creating an escrow.
- Amount rules: which currencies can be escrowed on testnet today (XRP certainly; anything else is
  a **VERIFY**, including stable-coin or token escrow).

## Crypto-condition checklist (VERIFY against the spec and docs vectors)

- Use a PREIMAGE-SHA-256 condition. Generate the preimage with a cryptographically secure random
  source, 32 bytes. Never derive it from anything guessable.
- Condition = the encoded SHA-256 of the preimage; fulfillment = the encoded preimage. Check the
  exact byte layout and hex casing against the published example vectors, and unit-test your encoder
  against those vectors **before** using it with real transactions.
- The system that decides to release funds is the one that holds the fulfillment. The backend that
  creates the escrow should store only the condition. Decide explicitly where the fulfillment lives
  and write that down in the README threat model.

## Key management and the kill switch (VERIFY)

- Which transaction types the master key may sign, which the regular key may sign, and which only
  the master key may sign. Confirm that the agent's regular key cannot undo its own revocation.
- The agent process holds only the regular key. The master key stays with the human side and is
  used only to rotate or revoke.
- The kill switch must block *signing in the agent process first* (instant, local, cannot be
  raced), and rotate or revoke the on-chain key second. Test that a blocked agent really cannot
  produce a signature.
- A rotated-away key must provably fail afterwards. Add a test or demo step that shows it.

## Policy engine rules (plain code)

- Pure function: (intent, config, state) to (decision, rule, reason). No I/O, no clock reads
  inside; pass the time in. Deterministic and table-testable.
- Check order: kill switch, input validation, allow/deny lists, per-transaction cap, rolling daily
  cap, then the route (auto-pay or escrow). First failing rule wins and is named in the result.
- State that decides money (daily total) is derived from the audit log or ledger, not from memory
  that disappears on restart.
- Every rule has at least one test for "just under", "exactly at" and "just over".

## Testing strategy

1. **Unit tests, no network:** policy tables, amount parsing, condition encoding against published
   vectors, audit-log writing and ordering, kill-switch state.
2. **Fake-ledger integration tests:** the whole flow (intent, policy, ledger adapter, audit) against
   a scripted fake that can also simulate failures, timeouts and duplicate submissions.
3. **One live smoke script, gated by an env flag,** that funds if needed, runs each route on the
   real testnet, and prints hashes. This is also the one-command demo. It must be re-runnable.
4. Run the full suite before every push. A red suite is not pushed during the window.

## Debugging flaky testnet

| Symptom | First move |
| --- | --- |
| Connect or request timeout | Check health call, reconnect with backoff, try the alternate public endpoint (**VERIFY** list) |
| Faucet error or empty balance | Wait and retry once, then use the reserve wallet |
| Sequence or last-ledger error | Re-read account state, rebuild the transaction, resubmit once |
| "Unknown" outcome | Look up by hash, do not resubmit until known |
| Works locally, fails on demo machine | Compare Node version, clock skew and network (captive portals, VPNs) |

Keep a pre-demo checklist: node version, endpoint health, wallets funded, `.env` present,
suite green, one dry run of the demo script.

## Verified facts (researcher fills this in; builder trusts this over memory)

| Fact | Source URL | Date verified | Verified by |
| --- | --- | --- | --- |
| Conditional escrow: required and optional fields |  |  |  |
| Escrow cancel rules (who, when) |  |  |  |
| Escrow finish: fee formula with fulfillment |  |  |  |
| PREIMAGE-SHA-256 encoding vectors |  |  |  |
| Regular key: which transaction types it can and cannot sign |  |  |  |
| Master key: what only it can do |  |  |  |
| Testnet endpoints and faucet usage / limits |  |  |  |
| Explorer URL format for testnet transactions |  |  |  |
| Stable-coin or token availability on testnet |  |  |  |
| Status of newer amendments on testnet (credentials, tokenised escrow, etc.) |  |  |  |
| Hardware-wallet support: which transaction types the device app can sign |  |  |  |
