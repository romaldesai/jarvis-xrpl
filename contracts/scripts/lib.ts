// Shared helpers for deploy/demo scripts. Never prints keys.
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

export const FAUCET_URL = "https://faucet.xrplevm.org";
export const EXPLORER_URL = process.env.EVM_EXPLORER_URL || "https://explorer.testnet.xrplevm.org";
export const isLocal = () => ["hardhat", "localhost"].includes(network.name);

export function deploymentFile(): string {
  return path.join(__dirname, "..", "deployments", isLocal() ? `${network.name}.local.json` : `${network.name}.json`);
}

export function readDeployment(): Record<string, any> {
  const f = deploymentFile();
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}

export function writeDeployment(d: Record<string, any>) {
  fs.mkdirSync(path.dirname(deploymentFile()), { recursive: true });
  fs.writeFileSync(deploymentFile(), JSON.stringify(d, null, 2) + "\n");
}

export const txLink = (hash: string) => (isLocal() ? `(local) ${hash}` : `${EXPLORER_URL}/tx/${hash}`);
export const addrLink = (a: string) => (isLocal() ? a : `${EXPLORER_URL}/address/${a}`);

/**
 * Legacy (type 0) transactions by default: some XRPL EVM testnet setups reject EIP-1559 type-2 txs.
 * Set EVM_TX_TYPE=eip1559 to let ethers choose.
 */
export async function txOverrides(): Promise<{ type?: number; gasPrice?: bigint }> {
  if ((process.env.EVM_TX_TYPE || "legacy") !== "legacy") return {};
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.gasPrice && fee.gasPrice > 0n ? fee.gasPrice : ethers.parseUnits("1", "gwei");
  return { type: 0, gasPrice };
}

/** Exit with a friendly faucet hint if an address has no gas. */
export async function requireGas(address: string, label: string) {
  const bal = await ethers.provider.getBalance(address);
  console.log(`${label} ${address} gas=${ethers.formatEther(bal)} XRP`);
  if (bal === 0n) {
    console.log(`\n${label} has 0 testnet XRP. Get gas at ${FAUCET_URL} (choose Testnet, paste ${address}), then re-run.`);
    process.exit(2);
  }
}

export async function assertChain() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId !== 31337n && chainId !== 1449000n) throw new Error(`Refusing: chainId ${chainId} is not XRPL EVM testnet (1449000) or local`);
  return chainId;
}
