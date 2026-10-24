#!/usr/bin/env bash
# One-command LOCAL demo: real contracts + real EIP-712 vouchers on a local Hardhat chain (no testnet needed).
#   ./scripts/local-demo.sh            # headless run with guardrail beats
#   ./scripts/local-demo.sh --web      # leave the chain running and start the web app
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
[ -d node_modules ] || npm install
[ -f .env ] || cp .env.example .env
npx tsx agent/scripts/wallet-new.ts >/dev/null

if ! curl -s -o /dev/null -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545; then
  echo "starting local Hardhat chain on :8545"
  (cd contracts && npx hardhat node > "$ROOT/.hardhat-node.log" 2>&1 &)
  for i in $(seq 1 40); do curl -s -o /dev/null -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 && break; sleep 0.5; done
fi

# Give the .env agent wallet local gas (local chain only).
node --input-type=module -e '
import fs from "node:fs"; import { Wallet } from "ethers";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").map(l=>/^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m=>[m[1],m[2]]));
const a = new Wallet(env.AGENT_PRIVATE_KEY).address;
await fetch("http://127.0.0.1:8545",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"hardhat_setBalance",params:[a,"0x56BC75E2D63100000"]})});
console.log("local gas -> " + a);'

export EVM_RPC_URL=http://127.0.0.1:8545 EVM_CHAIN_ID=31337 SETTLEMENT_RAIL=evm
# Separate audit log so local runs never eat into the testnet demo's 24h budget.
export AUDIT_LOG_PATH=./audit.local.jsonl
export AP4M_LEDGER_ADDRESS= AP4M_CHANNEL_ID= RLUSD_ADDRESS= FUNDER_PRIVATE_KEY=
(cd contracts && npx hardhat run scripts/deploy.ts --network localhost && npx hardhat run scripts/open-channel.ts --network localhost)

if [ "${1:-}" = "--web" ]; then
  echo "starting web app on http://localhost:3000 (local chain)"
  exec npm run dev -w web
fi
npx tsx agent/scripts/demo-headless.ts --yes --guardrails
