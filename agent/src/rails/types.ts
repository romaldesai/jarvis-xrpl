import type { ApprovedAction } from "../approval";

export interface ChannelState {
  channelId: string;
  capCents: bigint;
  redeemedCents: bigint;
  settledCents: bigint;
  remainingCents: bigint;
}

export interface TxProof {
  step: string; // "redeemVoucher" | "settle" | "Payment"
  txHash: string;
  explorerUrl: string | null;
}

export interface ChainEvent {
  name: string; // "VoucherRedeemed" | "ClaimPaid" | "SettlementRecorded" | "Payment"
  args: Record<string, string>;
}

export interface SettlementResult {
  rail: string;
  simulatedChain: boolean;
  proofs: TxProof[];
  events: ChainEvent[];
  payout: string; // address that received funds
  amountDisplay: string;
  /** Decimals of amounts in event args (EVM rail); absent for mock/xrpl. */
  tokenDecimals?: number;
}

export type StepCallback = (step: string, detail?: Record<string, unknown>) => void;

export interface RailInfo {
  name: string;
  network: string;
  explorerUrl: string | null;
  simulatedChain: boolean;
  agentAddress?: string;
  ledger?: string;
  channelId?: string;
  /** "mock RLUSD" on testnet until a real RLUSD is configured. */
  tokenLabel?: string;
}

export interface Rail {
  info(): RailInfo;
  channelState(): Promise<ChannelState | null>;
  /** Must call `consume(action)` and refuse if false, and re-check the kill switch, before signing. */
  execute(action: ApprovedAction, guard: SignGuard, onStep?: StepCallback): Promise<SettlementResult>;
}

/** Signing guard handed to rails: gate consumption + live kill-switch check. */
export interface SignGuard {
  assertMaySign(action: ApprovedAction): void;
}
