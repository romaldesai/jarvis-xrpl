// Preflight: gas for agent (+ funder if FUNDER_PRIVATE_KEY set, + registered FUNDER_ADDRESS). Prints faucet link at 0.
import { ethers } from "hardhat";
import { FAUCET_URL, assertChain } from "./lib";

async function main() {
  const chainId = await assertChain();
  const signers = await ethers.getSigners();
  console.log(`chain ${chainId} OK`);
  const rows: [string, string][] = [];
  if (signers[0]) rows.push(["agent", signers[0].address]);
  if (signers[1]) rows.push(["funder (key in .env)", signers[1].address]);
  const reg = process.env.FUNDER_ADDRESS;
  if (reg && ethers.isAddress(reg) && !rows.some(([, a]) => a.toLowerCase() === reg.toLowerCase())) rows.push(["registered funder (no key)", reg]);
  let missing = false;
  for (const [label, a] of rows) {
    const bal = await ethers.provider.getBalance(a);
    const zero = bal === 0n;
    if (zero && label.startsWith("agent")) missing = true;
    console.log(`${label.padEnd(28)} ${a}  ${ethers.formatEther(bal)} XRP${zero ? `   <- 0: fund at ${FAUCET_URL}` : ""}`);
  }
  if (!signers[0]) { console.log("No AGENT_PRIVATE_KEY. Run: npm run wallet:new"); process.exit(2); }
  if (missing) process.exit(2);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
