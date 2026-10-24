// Orchestrator: LLM proposes -> policy decides -> human approves -> rail settles -> everything audited.
import { randomBytes } from "node:crypto";
import { ApprovalError, ApprovalGate, type ApprovedAction, type PendingPayment } from "./approval";
import { AuditLog, type AuditEvent } from "./audit";
import type { AppConfig } from "./config";
import { parseIntent, type Intent } from "./intent";
import { isKillSwitchOn, setKillSwitch } from "./killswitch";
import { fmtInr, fmtRlusd, fmtUsd, formatMinor } from "./money";
import { evaluatePolicy, type Decision, type PolicyState } from "./policy";
import { buildQuote, getUsdInrRate, type Quote } from "./quote";
import type { ChannelState, Rail, RailInfo, SettlementResult, SignGuard } from "./rails/types";

export const maskUpi = (upi: string) => `•••@${upi.split("@")[1] ?? "upi"}`;

export interface Budget {
  perTxCapCents: string;
  dailyCapCents: string;
  spentTodayCents: string | null;
  dailyRemainingCents: string | null;
  channel: { channelId: string; capCents: string; redeemedCents: string; remainingCents: string } | null;
  display: { perTxCap: string; dailyCap: string; dailyRemaining: string | null; channelCap: string | null; channelRemaining: string | null };
}

export interface PaymentCard {
  id: string | null;
  status: "awaiting_approval" | "denied" | "not_understood";
  text: string;
  parser: Intent["source"] | null;
  recipient: string | null;
  upiMasked: string | null;
  quote: SerializedQuote | null;
  decision: Decision;
  budget: Budget;
  rail: RailInfo;
}

export interface SerializedQuote {
  inr: string;
  usd: string;
  fee: string;
  total: string;
  rlusd: string;
  rate: string;
  rateSource: "live" | "static";
  rateAsOf: string;
  totalCents: string;
  rlusdWei: string;
}

export interface SimulatedPayout {
  label: "SIMULATED";
  rail: "UPI";
  upiMasked: string;
  amountInr: string;
  reference: string;
  note: string;
}

export interface ApproveResult {
  ok: boolean;
  id: string;
  rule?: string;
  error?: string;
  settlement?: SettlementResult;
  payout?: SimulatedPayout;
  budget: Budget;
}

function serializeQuote(q: Quote): SerializedQuote {
  return {
    inr: fmtInr(q.inrPaise),
    usd: fmtUsd(q.usdCents),
    fee: fmtUsd(q.feeCents),
    total: fmtUsd(q.totalCents),
    rlusd: fmtRlusd(q.totalCents),
    rate: `1 USD = ₹${formatMinor(q.rate.micro / 10_000n, 2)}`,
    rateSource: q.rate.source,
    rateAsOf: q.rate.asOf,
    totalCents: q.totalCents.toString(),
    rlusdWei: q.rlusdWei.toString(),
  };
}

export interface AgentDeps {
  rail: Rail;
  audit?: AuditLog;
  gate?: ApprovalGate;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

export class RemittanceAgent {
  readonly rail: Rail;
  readonly audit: AuditLog;
  readonly gate: ApprovalGate;
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private env: NodeJS.ProcessEnv;

  constructor(readonly cfg: AppConfig, deps: AgentDeps) {
    this.rail = deps.rail;
    this.audit = deps.audit ?? new AuditLog(cfg.auditPath);
    this.gate = deps.gate ?? new ApprovalGate();
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.env = deps.env ?? process.env;
  }

  killed(): boolean {
    return isKillSwitchOn(this.cfg.killSwitch, this.env);
  }

  private async channel(): Promise<ChannelState | null | "error"> {
    try {
      return await this.rail.channelState();
    } catch {
      return "error";
    }
  }

  private async state(): Promise<{ s: PolicyState; ch: ChannelState | null }> {
    const ch = await this.channel();
    return {
      s: {
        killed: this.killed(),
        spentTodayCents: ch === "error" ? null : this.audit.spentLast24hCents(this.now()), // chain unreadable -> fail closed
        channelRemainingCents: ch && ch !== "error" ? ch.remainingCents : null,
      },
      ch: ch === "error" ? null : ch,
    };
  }

  async budget(): Promise<Budget> {
    const { s, ch } = await this.state();
    return this.toBudget(s, ch);
  }

  private toBudget(s: PolicyState, ch: ChannelState | null): Budget {
    const p = this.cfg.policy;
    const rem = s.spentTodayCents === null ? null : p.dailyCapCents - s.spentTodayCents;
    return {
      perTxCapCents: p.perTxCapCents.toString(),
      dailyCapCents: p.dailyCapCents.toString(),
      spentTodayCents: s.spentTodayCents?.toString() ?? null,
      dailyRemainingCents: rem === null ? null : (rem < 0n ? 0n : rem).toString(),
      channel: ch
        ? { channelId: ch.channelId, capCents: ch.capCents.toString(), redeemedCents: ch.redeemedCents.toString(), remainingCents: ch.remainingCents.toString() }
        : null,
      display: {
        perTxCap: fmtUsd(p.perTxCapCents),
        dailyCap: fmtUsd(p.dailyCapCents),
        dailyRemaining: rem === null ? null : fmtUsd(rem < 0n ? 0n : rem),
        channelCap: ch ? fmtRlusd(ch.capCents) : null,
        channelRemaining: ch ? fmtRlusd(ch.remainingCents) : null,
      },
    };
  }

  /** Step 1: parse + quote + policy. Nothing moves. */
  async prepare(text: string): Promise<PaymentCard> {
    const intent = await parseIntent(text, this.cfg.llm);
    const { s, ch } = await this.state();
    const rail = this.rail.info();
    if (!intent) {
      const decision: Decision = { allow: false, rule: "INVALID_AMOUNT", reason: "Could not find an amount. Try: Send ₹5,000 to my mother" };
      this.audit.append({ event: "deny", rule: decision.rule, reason: decision.reason, rail: rail.name });
      return { id: null, status: "not_understood", text, parser: null, recipient: null, upiMasked: null, quote: null, decision, budget: this.toBudget(s, ch), rail };
    }
    const rate = await getUsdInrRate(this.cfg.fx, this.fetchImpl, this.now());
    const quote = buildQuote(intent, rate, this.cfg.feeCents);
    const decision = evaluatePolicy({ recipient: intent.recipient, totalCents: quote.totalCents }, this.cfg.policy, s);
    const r = this.cfg.policy.recipients.find((x) => x.alias === intent.recipient);
    const base = {
      text,
      parser: intent.source,
      recipient: intent.recipient,
      upiMasked: r ? maskUpi(r.upiId) : null,
      quote: serializeQuote(quote),
      decision,
      budget: this.toBudget(s, ch),
      rail,
    };
    if (!decision.allow || !r) {
      this.audit.append({ event: "deny", rule: decision.rule, reason: decision.reason, totalCents: quote.totalCents.toString(), recipient: intent.recipient, parser: intent.source, rail: rail.name });
      return { id: null, status: "denied", ...base };
    }
    const pending = this.gate.prepare({ recipient: r.alias, upiId: r.upiId, quote }, this.now().getTime());
    this.audit.append({
      event: "prepare",
      id: pending.id,
      rule: decision.rule,
      reason: decision.reason,
      totalCents: quote.totalCents.toString(),
      inrPaise: quote.inrPaise.toString(),
      rateMicro: quote.rate.micro.toString(),
      rateSource: quote.rate.source,
      recipient: r.alias,
      upi: maskUpi(r.upiId),
      parser: intent.source,
      rail: rail.name,
    });
    return { id: pending.id, status: "awaiting_approval", ...base };
  }

  private guard(): SignGuard {
    return {
      assertMaySign: (action: ApprovedAction) => {
        if (this.killed()) throw new ApprovalError("KILL_SWITCH", "Kill switch is ON: signer refuses");
        if (!this.gate.consume(action)) throw new ApprovalError("NOT_APPROVED", "Action was not issued by the approval gate or was already used");
      },
    };
  }

  private lock: Promise<unknown> = Promise.resolve();

  /** Step 2: the human tapped Approve. Serialized so concurrent approvals can't both pass the daily cap. */
  approve(id: string, onStep?: (step: string, d?: Record<string, unknown>) => void): Promise<ApproveResult> {
    const run = this.lock.then(() => this.approveInner(id, onStep));
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Re-check policy, mint ApprovedAction, settle, audit. */
  private async approveInner(id: string, onStep?: (step: string, d?: Record<string, unknown>) => void): Promise<ApproveResult> {
    const rail = this.rail.info();
    let action: ApprovedAction;
    try {
      const { s } = await this.state();
      action = this.gate.approve(
        id,
        (p: PendingPayment) => evaluatePolicy({ recipient: p.recipient, totalCents: p.quote.totalCents }, this.cfg.policy, s),
        this.now().getTime(),
      );
    } catch (e) {
      const rule = e instanceof ApprovalError ? e.rule : "ERROR";
      const msg = e instanceof Error ? e.message : String(e);
      this.audit.append({ event: "deny", id, rule, reason: msg, rail: rail.name });
      return { ok: false, id, rule, error: msg, budget: await this.budget() };
    }
    this.audit.append({ event: "approve", id, rule: "HUMAN_APPROVED", totalCents: action.totalCents.toString(), recipient: action.recipient, rail: rail.name });

    try {
      let redeemLogged = false;
      const settlement = await this.rail.execute(action, this.guard(), (step, d) => {
        // Log the redeem the moment it lands: from here the spend is committed on-chain even if settle fails.
        if (step === "redeemed") {
          redeemLogged = true;
          this.audit.append({ event: "redeem", id, rule: "OK", txHash: String(d?.txHash ?? ""), explorerUrl: (d?.explorerUrl as string) ?? undefined, totalCents: action.totalCents.toString(), rail: rail.name });
        }
        onStep?.(step, d);
      });
      for (const p of settlement.proofs) {
        if (p.step === "redeemVoucher" && redeemLogged) continue;
        this.audit.append({
          event: p.step === "redeemVoucher" ? "redeem" : "settle",
          id,
          rule: "OK",
          txHash: p.txHash,
          explorerUrl: p.explorerUrl ?? undefined,
          totalCents: action.totalCents.toString(),
          rail: settlement.rail,
          simulatedChain: settlement.simulatedChain,
        });
      }
      const payout: SimulatedPayout = {
        label: "SIMULATED",
        rail: "UPI",
        upiMasked: maskUpi(action.upiId),
        amountInr: fmtInr(action.quote.inrPaise),
        reference: `SIM-UTR-${randomBytes(6).toString("hex").toUpperCase()}`,
        note: "Simulated payout. A licensed Indian off-ramp partner would credit the UPI account in production.",
      };
      return { ok: true, id, settlement, payout, budget: await this.budget() };
    } catch (e) {
      const rule = e instanceof ApprovalError ? e.rule : "SETTLEMENT_FAILED";
      const short = (e as { shortMessage?: string })?.shortMessage;
      const msg = (short ?? (e instanceof Error ? e.message : String(e))).slice(0, 200);
      this.audit.append({ event: "fail", id, rule, reason: msg, rail: rail.name });
      return { ok: false, id, rule, error: msg, budget: await this.budget() };
    }
  }

  reject(id: string): { ok: boolean } {
    const p = this.gate.reject(id);
    this.audit.append({ event: "reject", id, rule: "HUMAN_REJECTED", reason: p ? "User tapped Reject" : "Unknown id", rail: this.rail.info().name });
    return { ok: !!p };
  }

  setKill(on: boolean): { killed: boolean } {
    setKillSwitch(this.cfg.killSwitch, on);
    this.audit.append({ event: "kill", rule: "KILL_SWITCH", reason: on ? "Kill switch turned ON" : "Kill switch turned OFF" });
    return { killed: this.killed() };
  }

  auditTail(n = 50): AuditEvent[] {
    try {
      return this.audit.tail(n);
    } catch {
      return [];
    }
  }
}
