// Deploy MockRLUSD (unless RLUSD_ADDRESS is set) + ParticipantRegistry + PaymentLedger,
// KYA-register the agent bound to PAYOUT_ADDRESS, write public data to deployments/<network>.json.
//   npx hardhat run scripts/deploy.ts --network xrplevmTestnet      (REDEPLOY=1 to force)
import { ethers, network } from "hardhat";
import { assertChain, deploymentFile, isLocal, readDeployment, requireGas, txLink, txOverrides, writeDeployment } from "./lib";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set AGENT_PRIVATE_KEY in .env (npm run wallet:new).");
  const chainId = await assertChain();
  const existing = readDeployment();
  if (existing.ledger && !isLocal() && process.env.REDEPLOY !== "1") {
    console.log(`Already deployed (${deploymentFile()}): ledger ${existing.ledger}. Set REDEPLOY=1 to deploy fresh.`);
    return;
  }
  const payout = process.env.PAYOUT_ADDRESS && ethers.isAddress(process.env.PAYOUT_ADDRESS)
    ? process.env.PAYOUT_ADDRESS
    : isLocal() ? ethers.Wallet.createRandom().address : undefined;
  if (!payout) throw new Error("Set PAYOUT_ADDRESS in .env (npm run wallet:new writes one).");

  console.log(`network=${network.name} chainId=${chainId} txType=${process.env.EVM_TX_TYPE || "legacy"}`);
  await requireGas(deployer.address, "agent/deployer");
  const ov = await txOverrides();
  const decimals = Number(process.env.RLUSD_DECIMALS || 18);

  let tokenAddr = process.env.RLUSD_ADDRESS;
  let rlusdIsMock = false;
  const txs: Record<string, string> = {};
  if (!tokenAddr || !ethers.isAddress(tokenAddr)) {
    const token = await (await ethers.getContractFactory("MockRLUSD", deployer)).deploy(deployer.address, decimals, ov);
    await token.waitForDeployment();
    tokenAddr = await token.getAddress();
    rlusdIsMock = true;
    txs.deployMockRLUSD = token.deploymentTransaction()!.hash;
    console.log(`MockRLUSD (${decimals}dp)   ${tokenAddr}  ${txLink(txs.deployMockRLUSD)}`);
  } else if ((await ethers.provider.getCode(tokenAddr)) === "0x") {
    throw new Error(`RLUSD_ADDRESS ${tokenAddr} has no code on this chain. Unset it to deploy MockRLUSD.`);
  }
  const registry = await (await ethers.getContractFactory("ParticipantRegistry", deployer)).deploy(deployer.address, ov);
  await registry.waitForDeployment();
  txs.deployRegistry = registry.deploymentTransaction()!.hash;
  console.log(`ParticipantRegistry ${await registry.getAddress()}  ${txLink(txs.deployRegistry)}`);
  const ledger = await (await ethers.getContractFactory("PaymentLedger", deployer)).deploy(tokenAddr, await registry.getAddress(), deployer.address, ov);
  await ledger.waitForDeployment();
  txs.deployLedger = ledger.deploymentTransaction()!.hash;
  console.log(`PaymentLedger       ${await ledger.getAddress()}  ${txLink(txs.deployLedger)}`);

  const reg = await registry.register(deployer.address, payout, ethers.id("kya:xrp2india-agent-v1"), ov);
  await reg.wait();
  txs.kyaRegister = reg.hash;
  console.log(`KYA register agent=${deployer.address} payout=${payout}  ${txLink(reg.hash)}`);

  writeDeployment({
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    agent: deployer.address,
    payout,
    rlusd: tokenAddr,
    rlusdIsMock,
    rlusdDecimals: rlusdIsMock ? decimals : Number(await (await ethers.getContractAt("MockRLUSD", tokenAddr)).decimals()),
    registry: await registry.getAddress(),
    ledger: await ledger.getAddress(),
    txs,
  });
  console.log(`wrote ${deploymentFile()}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
