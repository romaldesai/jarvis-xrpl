// Generate a throwaway TESTNET agent key + payout address into .env. Prints addresses only.
//   npm run wallet:new            (keeps existing values)
//   npm run wallet:new -- --force (replace)
import { Wallet } from "ethers";
import { readEnv, upsertEnv } from "./envfile";

const force = process.argv.includes("--force");
const agent = Wallet.createRandom();
const payout = Wallet.createRandom();
const wroteKey = upsertEnv("AGENT_PRIVATE_KEY", agent.privateKey, force);
const wrotePayout = upsertEnv("PAYOUT_ADDRESS", payout.address, force);
const env = readEnv();
const addr = new Wallet(env.AGENT_PRIVATE_KEY).address;
console.log(wroteKey ? `agent wallet created: ${addr}` : `agent wallet already set: ${addr} (use --force to replace)`);
console.log(wrotePayout ? `payout address created: ${payout.address}` : `payout address already set: ${env.PAYOUT_ADDRESS}`);
console.log("Private key written to .env only (gitignored). It was not printed.");
console.log(`Next: get testnet gas for ${addr} at https://faucet.xrplevm.org`);
