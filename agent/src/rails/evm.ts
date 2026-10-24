// AP4M rail: EIP-712 voucher -> PaymentLedger.redeemVoucher -> settle, on XRPL EVM Sidechain testnet.
import { Contract, JsonRpcProvider, NonceManager, Wallet, id as keccakId, parseUnits, type TransactionReceipt } from "ethers";
import type { ApprovedAction } from "../approval";
import { baseToCentsFloor, fmtRlusd } from "../money";
import type { ChainEvent, ChannelState, Rail, RailInfo, SettlementResult, SignGuard, StepCallback } from "./types";

// Minimal ABI: swapping to Mastercard's official contracts = new addresses (+ this ABI if it differs).
export const LEDGER_ABI = [
  "function token() view returns (address)",
  "function channels(uint256) view returns (address funder, address agent, address payout, uint256 cap, uint256 redeemed, uint256 settled, uint256 lastNonce, bool closed)",
  "function redeemVoucher((uint256 channelId,uint256 cumulativeAmount,uint256 nonce,uint256 deadline,bytes32 ref) v, bytes signature)",
  "function settle(uint256 channelId) returns (uint256)",
  "function paused() view returns (bool)",
  "event VoucherRedeemed(uint256 indexed channelId, uint256 cumulativeAmount, uint256 delta, uint256 nonce, bytes32 ref)",
  "event ClaimPaid(uint256 indexed channelId, address indexed payout, uint256 amount)",
  "event SettlementRecorded(uint256 indexed channelId, uint256 settled, uint256 redeemed)",
  "error AgentNotVerified()",
  "error UnknownChannel()",
  "error ChannelIsClosed()",
  "error BadSignature()",
  "error NonMonotonic()",
  "error NonceUsed()",
  "error OverCap()",
  "error Expired()",
  "error EnforcedPause()",
];

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "channelId", type: "uint256" },
    { name: "cumulativeAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "ref", type: "bytes32" },
  ],
};

export const VOUCHER_TTL_SECONDS = 600;

export interface EvmRailConfig {
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  agentKey: string;
  ledger: string;
  channelId: bigint;
  txType?: "legacy" | "eip1559";
  tokenDecimals?: number;
  tokenLabel?: string;
}

export class EvmRail implements Rail {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private ledger: Contract;
  private decimalsChecked = false;
  private decimals: number;
  private label: string;

  constructor(private cfg: EvmRailConfig) {
    // cacheTimeout -1: never serve a cached nonce/state between back-to-back txs.
    this.provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, cacheTimeout: -1 });
    this.wallet = new Wallet(cfg.agentKey, this.provider);
    this.ledger = new Contract(cfg.ledger, LEDGER_ABI, new NonceManager(this.wallet));
    this.decimals = cfg.tokenDecimals ?? 18;
    this.label = cfg.tokenLabel ?? "mock RLUSD";
  }

  info(): RailInfo {
    return {
      name: "evm",
      network: this.cfg.chainId === 1449000 ? "XRPL EVM Sidechain testnet (1449000)" : `local EVM (${this.cfg.chainId})`,
      explorerUrl: this.cfg.chainId === 1449000 ? this.cfg.explorerUrl : null,
      simulatedChain: false,
      agentAddress: this.wallet.address,
      ledger: this.cfg.ledger,
      channelId: this.cfg.channelId.toString(),
      tokenLabel: this.label,
    };
  }

  private link(hash: string) {
    return this.cfg.chainId === 1449000 ? `${this.cfg.explorerUrl}/tx/${hash}` : null;
  }

  /** Fail closed if the on-chain token decimals differ from config (amounts would be wrong by powers of 10). */
  private async checkDecimals() {
    if (this.decimalsChecked) return;
    const token = new Contract(await this.ledger.token(), ["function decimals() view returns (uint8)"], this.provider);
    const onChain = Number(await token.decimals());
    if (onChain !== this.decimals) throw new Error(`token decimals mismatch: chain=${onChain} config=${this.decimals} (set RLUSD_DECIMALS)`);
    this.decimalsChecked = true;
  }

  private async overrides(): Promise<{ type?: number; gasPrice?: bigint }> {
    if (this.cfg.txType === "eip1559") return {};
    const fee = await this.provider.getFeeData();
    return { type: 0, gasPrice: fee.gasPrice && fee.gasPrice > 0n ? fee.gasPrice : parseUnits("1", "gwei") };
  }

  async channelState(): Promise<ChannelState> {
    await this.checkDecimals();
    const c = await this.ledger.channels(this.cfg.channelId);
    if (c.agent === "0x0000000000000000000000000000000000000000") throw new Error(`channel ${this.cfg.channelId} not found`);
    const cap = baseToCentsFloor(c.cap, this.decimals);
    const redeemed = baseToCentsFloor(c.redeemed, this.decimals);
    return {
      channelId: this.cfg.channelId.toString(),
      capCents: cap,
      redeemedCents: redeemed,
      settledCents: baseToCentsFloor(c.settled, this.decimals),
      remainingCents: c.closed ? 0n : cap - redeemed,
    };
  }

  /** Build the next voucher for `action` from on-chain channel state (cumulative watermark + next nonce). */
  async buildVoucher(action: Pick<ApprovedAction, "id" | "rlusdWei">) {
    const c = await this.ledger.channels(this.cfg.channelId);
    if (c.agent.toLowerCase() !== this.wallet.address.toLowerCase()) throw new Error("agent key does not match channel agent");
    const cumulativeAmount: bigint = c.redeemed + action.rlusdWei;
    if (cumulativeAmount > c.cap) throw new Error("voucher would exceed channel cap");
    const block = await this.provider.getBlock("latest");
    return {
      channel: c,
      voucher: {
        channelId: this.cfg.channelId,
        cumulativeAmount,
        nonce: (c.lastNonce as bigint) + 1n,
        deadline: BigInt((block?.timestamp ?? Math.floor(Date.now() / 1000)) + VOUCHER_TTL_SECONDS),
        ref: keccakId(`xrp2india:${action.id}`),
      },
    };
  }

  async execute(action: ApprovedAction, guard: SignGuard, onStep: StepCallback = () => {}): Promise<SettlementResult> {
    await this.checkDecimals();
    const { channel: c, voucher } = await this.buildVoucher(action);
    const domain = { name: "AP4M PaymentLedger", version: "1", chainId: this.cfg.chainId, verifyingContract: this.cfg.ledger };

    guard.assertMaySign(action); // gate consumption + kill switch, immediately before signing
    onStep("signing", { cumulativeAmount: voucher.cumulativeAmount.toString(), nonce: voucher.nonce.toString() });
    const sig = await this.wallet.signTypedData(domain, VOUCHER_TYPES, voucher);

    onStep("redeeming");
    const tx1 = await this.ledger.redeemVoucher(voucher, sig, await this.overrides());
    const rc1: TransactionReceipt = await tx1.wait();
    onStep("redeemed", { txHash: rc1.hash, explorerUrl: this.link(rc1.hash) });

    onStep("settling");
    const tx2 = await this.ledger.settle(this.cfg.channelId, await this.overrides());
    const rc2: TransactionReceipt = await tx2.wait();
    onStep("settled", { txHash: rc2.hash, explorerUrl: this.link(rc2.hash) });

    const events: ChainEvent[] = [];
    for (const log of [...rc1.logs, ...rc2.logs]) {
      try {
        const p = this.ledger.interface.parseLog(log);
        if (p) events.push({ name: p.name, args: Object.fromEntries(p.fragment.inputs.map((inp, i) => [inp.name, String(p.args[i])])) });
      } catch {
        /* not ours */
      }
    }
    return {
      rail: "evm",
      simulatedChain: false,
      proofs: [
        { step: "redeemVoucher", txHash: rc1.hash, explorerUrl: this.link(rc1.hash) },
        { step: "settle", txHash: rc2.hash, explorerUrl: this.link(rc2.hash) },
      ],
      events,
      payout: c.payout,
      amountDisplay: fmtRlusd(action.totalCents, this.label),
      tokenDecimals: this.decimals,
    };
  }
}
