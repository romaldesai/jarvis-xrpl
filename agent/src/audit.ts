// Append-only JSONL audit log. Never contains keys or seeds.
import fs from "node:fs";
import path from "node:path";

export type AuditEventType = "prepare" | "approve" | "redeem" | "settle" | "reject" | "deny" | "fail" | "kill" | "expire";

export interface AuditEvent {
  ts: string;
  event: AuditEventType;
  id?: string;
  rule?: string;
  reason?: string;
  txHash?: string;
  explorerUrl?: string;
  totalCents?: string;
  rail?: string;
  [k: string]: unknown;
}

const FORBIDDEN_KEYS = /key|seed|secret|mnemonic|password|signature/i;

export class AuditLog {
  constructor(readonly file: string) {}

  append(e: Omit<AuditEvent, "ts"> & { ts?: string }): AuditEvent {
    const rec: AuditEvent = { ts: e.ts ?? new Date().toISOString(), ...e } as AuditEvent;
    for (const k of Object.keys(rec)) if (FORBIDDEN_KEYS.test(k)) throw new Error(`audit: refusing to log field "${k}"`);
    const line = JSON.stringify(rec, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    fs.mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
    fs.appendFileSync(this.file, line + "\n", { flag: "a" });
    return rec;
  }

  /** All events. Throws if the file exists but has a corrupt line (caller fails closed). */
  read(): AuditEvent[] {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l, i) => {
        try {
          return JSON.parse(l) as AuditEvent;
        } catch {
          throw new Error(`audit: corrupt line ${i + 1}`);
        }
      });
  }

  tail(n: number): AuditEvent[] {
    return this.read().slice(-n);
  }

  /**
   * Committed spend in the rolling 24h window: approved payments minus those that later failed.
   * Derived from the log, so it survives restarts. Returns null if the log cannot be read.
   */
  spentLast24hCents(now: Date): bigint | null {
    let events: AuditEvent[];
    try {
      events = this.read();
    } catch {
      return null;
    }
    const since = now.getTime() - 24 * 3600 * 1000;
    // A failure releases budget only if nothing was redeemed on-chain for that payment.
    const redeemed = new Set(events.filter((e) => e.event === "redeem").map((e) => e.id));
    const failed = new Set(events.filter((e) => e.event === "fail" && !redeemed.has(e.id)).map((e) => e.id));
    let sum = 0n;
    for (const e of events) {
      if (e.event !== "approve" || failed.has(e.id)) continue;
      if (Date.parse(e.ts) < since) continue;
      sum += BigInt(e.totalCents ?? "0");
    }
    return sum;
  }
}
