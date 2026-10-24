// Fund the channel: mint/faucet MockRLUSD to the funder, approve, openChannel(agent, cap).
// Funder = FUNDER_PRIVATE_KEY (Mastercard-registered wallet) if set, else the agent key (demo fallback).
//
//   npx hardhat run scripts/open-channel.ts --network xrplevmTestnet
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const file = path.join(__dirname, "..", "deployments", ["hardhat", "localhost"].includes(network.name) ? `${network.name}.local.json` : `${network.name}.json`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const signers = await ethers.getSigners();
  const funderKey = process.env.FUNDER_PRIVATE_KEY;
  const funder = funderKey && /^0x[0-9a-fA-F]{64}$/.test(funderKey) && signers[1] ? signers[1] : signers[0];
  if (funder === signers[0]) console.log("FUNDER_PRIVATE_KEY not set: using agent wallet as funder (demo fallback).");
  const cap = ethers.parseUnits(process.env.CHANNEL_CAP_RLUSD || "500", 18);

  const token = await ethers.getContractAt("MockRLUSD", d.rlusd, funder);
  const ledger = await ethers.getContractAt("PaymentLedger", d.ledger, funder);

  const have = await token.balanceOf(funder.address);
  if (have < cap) {
    if (!d.rlusdIsMock) throw new Error("Funder lacks RLUSD and token is not the mock. Fund it first.");
    const need = cap - have;
    const step = ethers.parseUnits("1000", 18);
    for (let left = need; left > 0n; left -= left > step ? step : left) {
      const tx = await token.faucet(left > step ? step : left);
      await tx.wait();
      console.log(`faucet tx ${tx.hash}`);
    }
  }
  const ap = await token.approve(d.ledger, cap);
  await ap.wait();
  console.log(`approve tx ${ap.hash}`);
  const tx = await ledger.openChannel(d.agent, cap);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => { try { return ledger.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "ChannelOpened");
  const channelId = ev!.args.channelId.toString();
  console.log(`openChannel channelId=${channelId} cap=${ethers.formatUnits(cap, 18)} RLUSD funder=${funder.address} tx ${tx.hash}`);
  d.channelId = channelId;
  d.funder = funder.address;
  d.txs = { ...(d.txs || {}), openChannel: tx.hash };
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
