// Offline rail for tests and no-network demos. Clearly labelled SIMULATED CHAIN everywhere.
import { randomBytes } from "node:crypto";
import type { ApprovedAction } from "../approval";
import { fmtRlusd } from "../money";
import type { ChannelState, Rail, RailInfo, SettlementResult, SignGuard, StepCallback } from "./types";

export class MockRail implements Rail {
  private redeemed = 0n;
  private settled = 0n;
  constructor(private capCents = 50_000n, private failNext = false) {}

  info(): RailInfo {
    return { name: "mock", network: "SIMULATED CHAIN (offline)", explorerUrl: null, simulatedChain: true, channelId: "mock-1", tokenLabel: "mock RLUSD" };
  }

  async channelState(): Promise<ChannelState> {
    return {
      channelId: "mock-1",
      capCents: this.capCents,
      redeemedCents: this.redeemed,
      settledCents: this.settled,
      remainingCents: this.capCents - this.redeemed,
    };
  }

  setFailNext() {
    this.failNext = true;
  }

  async execute(action: ApprovedAction, guard: SignGuard, onStep: StepCallback = () => {}): Promise<SettlementResult> {
    guard.assertMaySign(action);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated chain failure");
    }
    const cumulative = this.redeemed + action.totalCents;
    if (cumulative > this.capCents) throw new Error("OverCap");
    const h1 = "0x" + randomBytes(32).toString("hex");
    const h2 = "0x" + randomBytes(32).toString("hex");
    onStep("redeemed", { txHash: h1 });
    const delta = cumulative - this.redeemed;
    this.redeemed = cumulative;
    const paid = this.redeemed - this.settled;
    this.settled = this.redeemed;
    onStep("settled", { txHash: h2 });
    return {
      rail: "mock",
      simulatedChain: true,
      proofs: [
        { step: "redeemVoucher", txHash: h1, explorerUrl: null },
        { step: "settle", txHash: h2, explorerUrl: null },
      ],
      events: [
        { name: "VoucherRedeemed", args: { channelId: "mock-1", cumulativeAmount: cumulative.toString(), delta: delta.toString() } },
        { name: "ClaimPaid", args: { channelId: "mock-1", amount: paid.toString() } },
        { name: "SettlementRecorded", args: { channelId: "mock-1", settled: this.settled.toString(), redeemed: this.redeemed.toString() } },
      ],
      payout: "mock-payout",
      amountDisplay: fmtRlusd(action.totalCents, "mock RLUSD"),
    };
  }
}
