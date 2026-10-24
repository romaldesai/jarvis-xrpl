// Fallback rail: faucet-fund a sender + payout wallet on XRPL Testnet and write them to .env.
import { fundTestnetWallet } from "@xrp2india/fallback";
import { readEnv, upsertEnv } from "./envfile";

const env = readEnv();
const ws = env.XRPL_WS_URL || "wss://s.altnet.rippletest.net:51233";
const force = process.argv.includes("--force");
const isSet = (v?: string) => v && !/^YOUR_.*_HERE$/.test(v);

if (isSet(env.XRPL_SENDER_SEED) && !force) console.log("XRPL_SENDER_SEED already set (use --force to replace)");
else {
  const s = await fundTestnetWallet(ws);
  upsertEnv("XRPL_SENDER_SEED", s.seed, true);
  console.log(`sender funded: ${s.address} balance=${s.balance} XRP (seed written to .env, not printed)`);
}
if (isSet(env.XRPL_PAYOUT_ADDRESS) && !force) console.log(`XRPL_PAYOUT_ADDRESS already set: ${env.XRPL_PAYOUT_ADDRESS}`);
else {
  const p = await fundTestnetWallet(ws); // payout needs >= base reserve to exist on ledger
  upsertEnv("XRPL_PAYOUT_ADDRESS", p.address, true);
  console.log(`payout funded: ${p.address}`);
}
