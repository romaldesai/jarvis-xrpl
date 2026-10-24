// Print public balances: agent gas, RLUSD (funder/payout/ledger), channel state, XRPL fallback wallets.
import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits } from "ethers";
import { Wallet as XWallet } from "xrpl";
import { xrplBalance } from "@xrp2india/fallback";
import { LEDGER_ABI, loadConfig, loadDeployment, loadEnv, repoRoot } from "../src/index";

loadEnv();
const chainId = Number(process.env.EVM_CHAIN_ID ?? 1449000);
const d = loadDeployment(repoRoot(), chainId) as Record<string, string>;
const cfg = loadConfig(process.env, d);
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"];

console.log(`EVM: ${cfg.evm.rpcUrl} (chain ${cfg.evm.chainId})`);
try {
  const provider = new JsonRpcProvider(cfg.evm.rpcUrl, cfg.evm.chainId, { staticNetwork: true });
  const agent = cfg.evm.agentKey ? new Wallet(cfg.evm.agentKey).address : null;
  const FAUCET = "https://faucet.xrplevm.org";
  const gas = async (label: string, a: string) => {
    const b = await provider.getBalance(a);
    console.log(`  ${label} ${a} gas=${formatEther(b)} XRP${b === 0n ? `   <- 0: get testnet XRP at ${FAUCET}` : ""}`);
  };
  if (agent) await gas("agent ", agent);
  else console.log("  no AGENT_PRIVATE_KEY yet: npm run wallet:new");
  const funder = process.env.FUNDER_ADDRESS;
  if (funder) await gas("funder", funder);
  if (cfg.evm.rlusd) {
    const t = new Contract(cfg.evm.rlusd, ERC20, provider);
    for (const [label, a] of [["agent", agent], ["funder", funder], ["payout", d.payout ?? process.env.PAYOUT_ADDRESS], ["ledger", cfg.evm.ledger]] as const)
      if (a) console.log(`  ${cfg.token.label} ${label.padEnd(6)} ${a} ${formatUnits(await t.balanceOf(a), cfg.token.decimals)}`);
  } else console.log("  no RLUSD address yet (deploy first)");
  if (cfg.evm.ledger && cfg.evm.channelId !== null) {
    const l = new Contract(cfg.evm.ledger, LEDGER_ABI, provider);
    const c = await l.channels(cfg.evm.channelId);
    const f = (v: bigint) => formatUnits(v, cfg.token.decimals);
    console.log(`  channel ${cfg.evm.channelId}: cap=${f(c.cap)} redeemed=${f(c.redeemed)} settled=${f(c.settled)} lastNonce=${c.lastNonce} closed=${c.closed}`);
  } else console.log("  no channel yet (open-channel first)");
} catch (e) {
  console.log(`  EVM unreachable: ${(e as Error).message.slice(0, 120)}`);
}

if (cfg.xrpl.senderSeed) {
  try {
    const sender = XWallet.fromSeed(cfg.xrpl.senderSeed).address;
    console.log(`XRPL: ${cfg.xrpl.wsUrl}`);
    console.log(`  sender ${sender} ${await xrplBalance(cfg.xrpl.wsUrl, sender)} XRP`);
    if (cfg.xrpl.payoutAddress) console.log(`  payout ${cfg.xrpl.payoutAddress} ${await xrplBalance(cfg.xrpl.wsUrl, cfg.xrpl.payoutAddress)} XRP`);
  } catch (e) {
    console.log(`  XRPL unreachable: ${(e as Error).message.slice(0, 120)}`);
  }
}
