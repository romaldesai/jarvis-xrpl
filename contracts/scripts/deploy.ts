// Deploy MockRLUSD + ParticipantRegistry + PaymentLedger, register the agent (KYA),
// and write public addresses to deployments/<network>.json. Never prints keys.
//
//   npx hardhat run scripts/deploy.ts --network xrplevmTestnet
//
// Env: AGENT_PRIVATE_KEY (deployer + agent), PAYOUT_ADDRESS. Optional RLUSD_ADDRESS to reuse a token.
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set AGENT_PRIVATE_KEY in .env (npm run wallet:new).");
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 31337n && chainId !== 1449000n) throw new Error(`Refusing: chainId ${chainId} is not XRPL EVM testnet (1449000)`);

  const agent = deployer.address;
  const payout = process.env.PAYOUT_ADDRESS && ethers.isAddress(process.env.PAYOUT_ADDRESS)
    ? process.env.PAYOUT_ADDRESS
    : ["hardhat", "localhost"].includes(network.name) ? ethers.Wallet.createRandom().address : undefined;
  if (!payout) throw new Error("Set PAYOUT_ADDRESS in .env (npm run wallet:new writes one).");

  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network=${network.name} chainId=${chainId} deployer=${deployer.address} gasBalance=${ethers.formatEther(bal)} XRP`);
  if (bal === 0n) throw new Error("Deployer has no gas. Fund it at https://faucet.xrplevm.org (testnet).");

  let tokenAddr = process.env.RLUSD_ADDRESS;
  let tokenIsMock = false;
  if (!tokenAddr || !ethers.isAddress(tokenAddr)) {
    const token = await ethers.deployContract("MockRLUSD", [deployer.address]);
    await token.waitForDeployment();
    tokenAddr = await token.getAddress();
    tokenIsMock = true;
    console.log(`MockRLUSD           ${tokenAddr}  tx ${token.deploymentTransaction()?.hash}`);
  }
  const registry = await ethers.deployContract("ParticipantRegistry", [deployer.address]);
  await registry.waitForDeployment();
  console.log(`ParticipantRegistry ${await registry.getAddress()}  tx ${registry.deploymentTransaction()?.hash}`);
  const ledger = await ethers.deployContract("PaymentLedger", [tokenAddr, await registry.getAddress(), deployer.address]);
  await ledger.waitForDeployment();
  console.log(`PaymentLedger       ${await ledger.getAddress()}  tx ${ledger.deploymentTransaction()?.hash}`);

  const reg = await registry.register(agent, payout, ethers.id("kya:xrp2india-agent-v1"));
  await reg.wait();
  console.log(`KYA register agent=${agent} payout=${payout} tx ${reg.hash}`);

  const out = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    agent,
    payout,
    rlusd: tokenAddr,
    rlusdIsMock: tokenIsMock,
    registry: await registry.getAddress(),
    ledger: await ledger.getAddress(),
    txs: { register: reg.hash },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ["hardhat", "localhost"].includes(network.name) ? `${network.name}.local.json` : `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
