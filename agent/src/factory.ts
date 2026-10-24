// Build an agent from env: picks the rail (SETTLEMENT_RAIL=evm|xrpl|mock) and loads deployment addresses.
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import { XrplRail } from "@xrp2india/fallback";
import { loadConfig, type AppConfig, type Deployment } from "./config";
import { EvmRail } from "./rails/evm";
import { MockRail } from "./rails/mock";
import type { Rail } from "./rails/types";
import { RemittanceAgent } from "./service";

/** Walk up from cwd to find the repo root (has contracts/ and agent/). */
export function repoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "contracts")) && fs.existsSync(path.join(dir, "agent"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function loadEnv(root = repoRoot()) {
  dotenv.config({ path: path.join(root, ".env") });
}

export function loadDeployment(root: string, chainId: number): Deployment {
  const name = chainId === 31337 ? "localhost.local.json" : "xrplevmTestnet.json";
  const f = path.join(root, "contracts", "deployments", name);
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

export function buildRail(cfg: AppConfig): Rail {
  if (cfg.rail === "mock") return new MockRail();
  if (cfg.rail === "xrpl") {
    if (!cfg.xrpl.senderSeed || !cfg.xrpl.payoutAddress) throw new Error("xrpl rail: set XRPL_SENDER_SEED and XRPL_PAYOUT_ADDRESS (npm run wallet:xrpl)");
    return new XrplRail({ ...cfg.xrpl, senderSeed: cfg.xrpl.senderSeed, payoutAddress: cfg.xrpl.payoutAddress }) as unknown as Rail;
  }
  const e = cfg.evm;
  if (!e.agentKey) throw new Error("evm rail: set AGENT_PRIVATE_KEY (npm run wallet:new)");
  if (!e.ledger || e.channelId === null) throw new Error("evm rail: no ledger/channel. Deploy + open channel first, or set AP4M_LEDGER_ADDRESS and AP4M_CHANNEL_ID");
  return new EvmRail({
    rpcUrl: e.rpcUrl,
    chainId: e.chainId,
    explorerUrl: e.explorerUrl,
    agentKey: e.agentKey,
    ledger: e.ledger,
    channelId: e.channelId,
    txType: e.txType,
    tokenDecimals: cfg.token.decimals,
    tokenLabel: cfg.token.label,
  });
}

export function createAgentFromEnv(): RemittanceAgent {
  const root = repoRoot();
  loadEnv(root);
  if (process.env.AUDIT_LOG_PATH && !path.isAbsolute(process.env.AUDIT_LOG_PATH)) process.env.AUDIT_LOG_PATH = path.join(root, process.env.AUDIT_LOG_PATH);
  if (!process.env.AUDIT_LOG_PATH) process.env.AUDIT_LOG_PATH = path.join(root, "audit.jsonl");
  if (process.env.KILL_SWITCH_FILE && !path.isAbsolute(process.env.KILL_SWITCH_FILE)) process.env.KILL_SWITCH_FILE = path.join(root, process.env.KILL_SWITCH_FILE);
  if (!process.env.KILL_SWITCH_FILE) process.env.KILL_SWITCH_FILE = path.join(root, "killswitch.flag");
  const chainId = Number(process.env.EVM_CHAIN_ID ?? 1449000);
  if (!process.env.FX_CACHE_FILE) process.env.FX_CACHE_FILE = path.join(root, ".fx-cache.json");
  const cfg = loadConfig(process.env, loadDeployment(root, chainId));
  return new RemittanceAgent(cfg, { rail: buildRail(cfg) });
}
