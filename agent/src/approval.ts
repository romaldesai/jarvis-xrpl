// The ONE approval gate. Only this module can mint an ApprovedAction, and every rail refuses
// anything the gate did not issue. Actions are single-use and pending items expire.
import { randomUUID } from "node:crypto";
import type { Quote } from "./quote";
import type { Decision } from "./policy";

declare const approvedBrand: unique symbol;

export interface PendingPayment {
  id: string;
  recipient: string;
  upiId: string;
  quote: Quote;
  createdAt: number; // ms
}

export interface ApprovedAction {
  readonly [approvedBrand]: true;
  readonly id: string;
  readonly recipient: string;
  readonly upiId: string;
  readonly totalCents: bigint;
  readonly rlusdWei: bigint;
  readonly quote: Quote;
  readonly approvedAt: string;
}

export class ApprovalError extends Error {
  constructor(readonly rule: string, message: string) {
    super(message);
  }
}

export class ApprovalGate {
  private pending = new Map<string, PendingPayment>();
  private issued = new WeakSet<object>();
  private consumed = new WeakSet<object>();

  constructor(private ttlMs = 10 * 60 * 1000) {}

  prepare(p: Omit<PendingPayment, "id" | "createdAt">, now = Date.now()): PendingPayment {
    const item = { ...p, id: randomUUID(), createdAt: now };
    this.pending.set(item.id, item);
    return item;
  }

  get(id: string): PendingPayment | undefined {
    return this.pending.get(id);
  }

  /**
   * Human approved `id`. `recheck` re-runs policy against fresh state (time-of-check = time-of-use).
   * Returns the typed ApprovedAction or throws ApprovalError. Removes the pending item either way.
   */
  approve(id: string, recheck: (p: PendingPayment) => Decision, now = Date.now()): ApprovedAction {
    const p = this.pending.get(id);
    if (!p) throw new ApprovalError("UNKNOWN_OR_USED", "No pending payment with that id (already approved, rejected or expired)");
    this.pending.delete(id);
    if (now - p.createdAt > this.ttlMs) throw new ApprovalError("EXPIRED", "Approval window expired; prepare the payment again");
    const d = recheck(p);
    if (!d.allow) throw new ApprovalError(d.rule, d.reason);
    const action = Object.freeze({
      id: p.id,
      recipient: p.recipient,
      upiId: p.upiId,
      totalCents: p.quote.totalCents,
      rlusdWei: p.quote.rlusdWei,
      quote: p.quote,
      approvedAt: new Date(now).toISOString(),
    }) as ApprovedAction;
    this.issued.add(action);
    return action;
  }

  reject(id: string): PendingPayment | undefined {
    const p = this.pending.get(id);
    this.pending.delete(id);
    return p;
  }

  /** Rails call this before signing. True exactly once per issued action. */
  consume(action: ApprovedAction): boolean {
    if (!this.issued.has(action) || this.consumed.has(action)) return false;
    this.consumed.add(action);
    return true;
  }
}
