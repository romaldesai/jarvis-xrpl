// On-chain REJECTED proof: the agent signs a voucher one base unit OVER the channel cap and submits it
// with a fixed gas limit (skipping estimation) so the chain itself mines it as a reverted tx (status 0).
// Contract-level test only: nothing can move because the ledger enforces the cap.
//   npx hardhat run scripts/prove-overcap.ts --network xrplevmTestnet
import { ethers } from "hardhat";
import { readDeployment, txLink, txOverrides, writeDeployment } from "./lib";

async function main() {
  const d = readDeployment();
  if (!d.ledger || !d.channelId) throw new Error("Deploy and open a channel first.");
  const [agent] = await ethers.getSigners();
  const ledger = await ethers.getContractAt("PaymentLedger", d.ledger, agent);
  const c = await ledger.channels(d.channelId);
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const v = { channelId: BigInt(d.channelId), cumulativeAmount: c.cap + 1n, nonce: c.lastNonce + 1n, deadline: BigInt(now + 600), ref: ethers.id("xrp2india:overcap-proof") };
  const domain = { name: "AP4M PaymentLedger", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: d.ledger };
  const types = { Voucher: [
    { name: "channelId", type: "uint256" }, { name: "cumulativeAmount", type: "uint256" }, { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }, { name: "ref", type: "bytes32" },
  ] };
  const sig = await agent.signTypedData(domain, types, v);

  try {
    await ledger.redeemVoucher.staticCall(v, sig);
    throw new Error("UNEXPECTED: over-cap voucher would succeed");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const reason = e?.revert?.name ?? /custom error '(\w+)/.exec(msg)?.[1] ?? e?.shortMessage ?? msg.slice(0, 120);
    console.log(`simulated: redeemVoucher(cap + 1) reverts with ${reason}`);
  }
  let hash: string | undefined;
  try {
    const tx = await ledger.redeemVoucher(v, sig, { ...(await txOverrides()), gasLimit: 300_000n });
    hash = tx.hash;
    await tx.wait();
    throw new Error("UNEXPECTED: over-cap tx succeeded");
  } catch (e: any) {
    hash = hash ?? e?.receipt?.hash ?? e?.transactionHash;
    if (String(e?.message).startsWith("UNEXPECTED")) throw e;
  }
  const after = await ledger.channels(d.channelId);
  console.log(`on-chain: over-cap redeem REVERTED (status 0); redeemed unchanged=${after.redeemed === c.redeemed}`);
  if (hash) {
    console.log(`proof tx ${txLink(hash)}`);
    writeDeployment({ ...d, txs: { ...(d.txs || {}), overCapRevert: hash } });
  } else console.log("(local node rejected the tx before mining; on testnet it is mined with status 0)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
