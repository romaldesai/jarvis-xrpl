// Fund the channel: faucet MockRLUSD to the funder, approve, openChannel(agent, cap).
// Funder = FUNDER_PRIVATE_KEY (Mastercard-registered wallet) if set, else the agent key (demo fallback).
//   npx hardhat run scripts/open-channel.ts --network xrplevmTestnet   (REOPEN=1 to open another channel)
import { ethers } from "hardhat";
import { readDeployment, requireGas, txLink, txOverrides, writeDeployment, isLocal } from "./lib";

async function main() {
  const d = readDeployment();
  if (!d.ledger) throw new Error("No deployment found. Run deploy first.");
  if (d.channelId && !isLocal() && process.env.REOPEN !== "1") {
    console.log(`Channel ${d.channelId} already open on ${d.ledger}. Set REOPEN=1 to open a new one.`);
    return;
  }
  const signers = await ethers.getSigners();
  const funderKey = process.env.FUNDER_PRIVATE_KEY;
  const funder = funderKey && /^0x[0-9a-fA-F]{64}$/.test(funderKey) && signers[1] ? signers[1] : signers[0];
  if (funder === signers[0]) console.log("FUNDER_PRIVATE_KEY not set: using agent wallet as funder (demo fallback).");
  await requireGas(funder.address, "funder");
  const ov = await txOverrides();

  const token = await ethers.getContractAt("MockRLUSD", d.rlusd, funder);
  const ledger = await ethers.getContractAt("PaymentLedger", d.ledger, funder);
  const decimals = Number(await token.decimals());
  const cap = ethers.parseUnits(process.env.CHANNEL_CAP_RLUSD || "500", decimals);

  const have = await token.balanceOf(funder.address);
  if (have < cap) {
    if (!d.rlusdIsMock) throw new Error("Funder lacks RLUSD and the token is not the mock. Fund it first.");
    const step = ethers.parseUnits("1000", decimals);
    for (let left = cap - have; left > 0n; ) {
      const amt = left > step ? step : left;
      const tx = await token.faucet(amt, ov);
      await tx.wait();
      console.log(`mock RLUSD faucet ${ethers.formatUnits(amt, decimals)}  ${txLink(tx.hash)}`);
      left -= amt;
    }
  }
  const ap = await token.approve(d.ledger, cap, ov);
  await ap.wait();
  console.log(`approve  ${txLink(ap.hash)}`);
  const tx = await ledger.openChannel(d.agent, cap, ov);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => { try { return ledger.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "ChannelOpened");
  const channelId = ev!.args.channelId.toString();
  console.log(`openChannel channelId=${channelId} cap=${ethers.formatUnits(cap, decimals)} mock RLUSD funder=${funder.address}  ${txLink(tx.hash)}`);
  writeDeployment({ ...d, channelId, funder: funder.address, capDisplay: `${ethers.formatUnits(cap, decimals)} ${d.rlusdIsMock ? "mock RLUSD" : "RLUSD"}`, txs: { ...(d.txs || {}), openChannel: tx.hash } });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
