// Fallback rail: native XRPL Testnet Payment via xrpl.js, behind the SAME policy + approval gate + audit.
// Selected with SETTLEMENT_RAIL=xrpl. Testnet XRP stands in for RLUSD at a fixed demo rate (XRPL_DROPS_PER_USD_CENT).
import { Client, Wallet, convertStringToHex, dropsToXrp, type Payment, type TxResponse } from "xrpl";

export interface XrplRailConfig {
  wsUrl: string;
  explorerUrl: string; // https://testnet.xrpl.org
  senderSeed: string;
  payoutAddress: string;
  dropsPerCent: bigint;
}

/** Structural subset of the agent's ApprovedAction / SignGuard (no import, no cycle). */
export interface PayableAction {
  readonly id: string;
  readonly totalCents: bigint;
}
export interface Guard<A> {
  assertMaySign(action: A): void;
}

export function assertTestnet(wsUrl: string) {
  if (!/altnet|testnet|devnet|localhost|127\.0\.0\.1/.test(wsUrl)) throw new Error("XRPL fallback is testnet-only");
}

export const xrplTxUrl = (explorer: string, hash: string) => `${explorer.replace(/\/$/, "")}/transactions/${hash}`;

export function centsToDrops(cents: bigint, dropsPerCent: bigint): string {
  if (cents <= 0n) throw new Error("amount must be positive");
  return (cents * dropsPerCent).toString();
}

export class XrplRail {
  private wallet: Wallet;
  constructor(private cfg: XrplRailConfig, private clientFactory = (url: string) => new Client(url)) {
    assertTestnet(cfg.wsUrl);
    this.wallet = Wallet.fromSeed(cfg.senderSeed);
  }

  info() {
    return {
      name: "xrpl",
      network: "XRPL Testnet (native)",
      explorerUrl: this.cfg.explorerUrl,
      simulatedChain: false,
      agentAddress: this.wallet.address,
    };
  }

  async channelState() {
    return null; // native rail has no on-chain channel; daily + per-tx caps still apply
  }

  async execute<A extends PayableAction>(action: A, guard: Guard<A>, onStep: (s: string, d?: Record<string, unknown>) => void = () => {}) {
    const drops = centsToDrops(action.totalCents, this.cfg.dropsPerCent);
    const client = this.clientFactory(this.cfg.wsUrl);
    await client.connect();
    try {
      const tx: Payment = {
        TransactionType: "Payment",
        Account: this.wallet.address,
        Destination: this.cfg.payoutAddress,
        Amount: drops,
        Memos: [{ Memo: { MemoType: convertStringToHex("xrp2india/ref"), MemoData: convertStringToHex(action.id) } }],
      };
      const prepared = await client.autofill(tx); // fills Sequence, Fee, LastLedgerSequence
      guard.assertMaySign(action);
      onStep("signing");
      const signed = this.wallet.sign(prepared);
      onStep("submitting", { txHash: signed.hash });
      const res: TxResponse = await client.submitAndWait(signed.tx_blob);
      const meta = res.result.meta;
      const code = typeof meta === "object" && meta ? (meta as { TransactionResult: string }).TransactionResult : "unknown";
      if (code !== "tesSUCCESS") throw new Error(`XRPL payment failed: ${code} (tx ${signed.hash})`);
      onStep("validated", { txHash: signed.hash, result: code });
      return {
        rail: "xrpl",
        simulatedChain: false,
        proofs: [{ step: "Payment", txHash: signed.hash, explorerUrl: xrplTxUrl(this.cfg.explorerUrl, signed.hash) }],
        events: [{ name: "Payment", args: { result: code, ledgerIndex: String(res.result.ledger_index ?? ""), drops } }],
        payout: this.cfg.payoutAddress,
        amountDisplay: `${dropsToXrp(drops)} XRP (testnet, stands in for RLUSD)`,
      };
    } finally {
      await client.disconnect();
    }
  }
}

/** Faucet-fund a fresh testnet wallet. Returns address + seed; callers must never print the seed. */
export async function fundTestnetWallet(wsUrl: string): Promise<{ address: string; seed: string; balance: number }> {
  assertTestnet(wsUrl);
  const client = new Client(wsUrl);
  await client.connect();
  try {
    const { wallet, balance } = await client.fundWallet();
    return { address: wallet.address, seed: wallet.seed!, balance };
  } finally {
    await client.disconnect();
  }
}

export async function xrplBalance(wsUrl: string, address: string): Promise<string> {
  assertTestnet(wsUrl);
  const client = new Client(wsUrl);
  await client.connect();
  try {
    return String(await client.getXrpBalance(address));
  } finally {
    await client.disconnect();
  }
}
