#!/usr/bin/env bash
# ONE COMMAND: XRPL EVM Sidechain testnet, end to end, from your Mac (Node 22+).
#   ./scripts/testnet-demo.sh          # prompts y/N before the payment moves
#   ./scripts/testnet-demo.sh --yes    # you are the human: pre-approve for a rehearsal
# Safe to re-run: deploy + channel are skipped when contracts/deployments/xrplevmTestnet.json exists
# (REDEPLOY=1 / REOPEN=1 to force). Prints a PASTE-BACK block (addresses + tx hashes, never keys).
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 22 ] || { echo "Node 22+ required (found $(node -v))"; exit 1; }
[ -d node_modules ] || npm install
[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "created .env"; }
unset EVM_CHAIN_ID AUDIT_LOG_PATH   # never inherit a local-chain shell
# Rehearsal only: REHEARSE_RPC=http://127.0.0.1:8546 with `HARDHAT_CHAIN_ID=1449000 npx hardhat node --port 8546`.
if [ -n "${REHEARSE_RPC:-}" ]; then export EVM_RPC_URL="$REHEARSE_RPC"; echo "REHEARSAL against $EVM_RPC_URL"; else unset EVM_RPC_URL; fi
export SETTLEMENT_RAIL=evm

echo "== 1/6 wallet"
npx tsx agent/scripts/wallet-new.ts

echo "== 2/6 preflight (gas)"
if ! npm run -s check:testnet -w contracts; then
  echo; echo "Fund the address(es) above at https://faucet.xrplevm.org (Testnet), wait ~1 min, then re-run this script."; exit 2
fi

echo "== 3/6 deploy contracts + KYA register (skipped if already deployed)"
npm run -s deploy:testnet -w contracts
echo "== 4/6 open funded channel (skipped if already open)"
npm run -s channel:testnet -w contracts

echo "== 5/6 payment: Send ₹5,000 to my mother  (+ REJECTED paths)"
npx tsx agent/scripts/demo-headless.ts --guardrails ${1:-} || echo "(demo exited non-zero; see above)"

echo "== 6/6 on-chain REJECTED proof: over-cap redeem reverts"
npm run -s prove:overcap -w contracts || echo "(over-cap proof step failed; see above)"

echo
echo "================ PASTE-BACK (public data only) ================"
npx tsx agent/scripts/proof.ts
echo "================================================================"
echo "Write it to docs/PROOF.md with: npm run proof -- --write"
