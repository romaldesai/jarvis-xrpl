import { parseDecimal } from "./money";

export type RailName = "evm" | "xrpl" | "mock";

export interface Recipient {
  alias: string; // canonical alias, e.g. "mother"
  upiId: string; // e.g. "mom.demo@okaxis" (demo value; never real PII)
}

export interface PolicyConfig {
  perTxCapCents: bigint;
  dailyCapCents: bigint;
  recipients: Recipient[];
}

export interface AppConfig {
  rail: RailName;
  policy: PolicyConfig;
  feeCents: bigint;
  fx: { apiUrl: string | null; staticMicro: bigint; timeoutMs: number };
  auditPath: string;
  killSwitch: { envVar: string; file: string };
  llm: { apiKey: string | null; model: string | null; timeoutMs: number };
  evm: {
    rpcUrl: string;
    chainId: number;
    explorerUrl: string;
    agentKey: string | null;
    ledger: string | null;
    registry: string | null;
    rlusd: string | null;
    channelId: bigint | null;
  };
  xrpl: {
    wsUrl: string;
    explorerUrl: string;
    senderSeed: string | null;
    payoutAddress: string | null;
    dropsPerCent: bigint;
  };
}

const isPlaceholder = (v?: string) => !v || /^YOUR_.*_HERE$/.test(v) || v === "REPLACE_ME";
const opt = (v?: string) => (isPlaceholder(v) ? null : v!.trim());

function int(env: NodeJS.ProcessEnv, key: string, dflt: string): bigint {
  const raw = env[key] ?? dflt;
  if (!/^\d+$/.test(raw)) throw new Error(`config: ${key} must be a non-negative integer`);
  return BigInt(raw);
}

export function parseRecipients(raw: string): Recipient[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [alias, upiId] = pair.split(":").map((x) => x?.trim());
      if (!alias || !upiId || !/^[\w.-]+@[\w]+$/.test(upiId)) throw new Error(`config: bad recipient entry "${alias ?? pair}"`);
      return { alias: alias.toLowerCase(), upiId };
    });
}

export interface Deployment {
  chainId?: number;
  ledger?: string;
  registry?: string;
  rlusd?: string;
  channelId?: string;
}

/** Build config from env (+ optional deployments file values). Throws on invalid money/policy values (fail closed). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, deployment: Deployment = {}): AppConfig {
  const rail = (env.SETTLEMENT_RAIL ?? "evm") as RailName;
  if (!["evm", "xrpl", "mock"].includes(rail)) throw new Error(`config: SETTLEMENT_RAIL must be evm|xrpl|mock`);
  const chainId = Number(env.EVM_CHAIN_ID ?? deployment.chainId ?? 1449000);
  if (![1449000, 31337].includes(chainId)) throw new Error(`config: EVM_CHAIN_ID ${chainId} is not XRPL EVM testnet (1449000) or local (31337)`);
  const xrplWs = env.XRPL_WS_URL ?? "wss://s.altnet.rippletest.net:51233";
  if (!/altnet|testnet|devnet|localhost|127\.0\.0\.1/.test(xrplWs)) throw new Error("config: XRPL_WS_URL must be a testnet endpoint");
  const channel = opt(env.AP4M_CHANNEL_ID) ?? deployment.channelId ?? null;

  const cfg: AppConfig = {
    rail,
    policy: {
      perTxCapCents: int(env, "POLICY_PER_TX_CAP_USD_CENTS", "10000"),
      dailyCapCents: int(env, "POLICY_DAILY_CAP_USD_CENTS", "25000"),
      recipients: parseRecipients(env.POLICY_ALLOWED_RECIPIENTS ?? "mother:mom.demo@okaxis,brother:bro.demo@okhdfcbank"),
    },
    feeCents: int(env, "FEE_USD_CENTS", "99"),
    fx: {
      apiUrl: opt(env.FX_API_URL) ?? "https://open.er-api.com/v6/latest/USD",
      staticMicro: parseDecimal(env.FX_STATIC_USD_INR ?? "88.00", 6),
      timeoutMs: 2500,
    },
    auditPath: env.AUDIT_LOG_PATH ?? "./audit.jsonl",
    killSwitch: { envVar: env.KILL_SWITCH ?? "0", file: env.KILL_SWITCH_FILE ?? "./killswitch.flag" },
    llm: { apiKey: opt(env.ANTHROPIC_API_KEY), model: opt(env.ANTHROPIC_MODEL), timeoutMs: 8000 },
    evm: {
      rpcUrl: env.EVM_RPC_URL ?? "https://rpc.testnet.xrplevm.org",
      chainId,
      explorerUrl: env.EVM_EXPLORER_URL ?? "https://explorer.testnet.xrplevm.org",
      agentKey: opt(env.AGENT_PRIVATE_KEY),
      ledger: opt(env.AP4M_LEDGER_ADDRESS) ?? deployment.ledger ?? null,
      registry: opt(env.AP4M_REGISTRY_ADDRESS) ?? deployment.registry ?? null,
      rlusd: opt(env.RLUSD_ADDRESS) ?? deployment.rlusd ?? null,
      channelId: channel ? BigInt(channel) : null,
    },
    xrpl: {
      wsUrl: xrplWs,
      explorerUrl: env.XRPL_EXPLORER_URL ?? "https://testnet.xrpl.org",
      senderSeed: opt(env.XRPL_SENDER_SEED),
      payoutAddress: opt(env.XRPL_PAYOUT_ADDRESS),
      dropsPerCent: int(env, "XRPL_DROPS_PER_USD_CENT", "1000"),
    },
  };
  if (cfg.policy.perTxCapCents <= 0n || cfg.policy.dailyCapCents <= 0n) throw new Error("config: caps must be > 0");
  return cfg;
}
