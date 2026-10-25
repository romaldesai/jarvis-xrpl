// Pure policy engine: (proposal, config, state) -> decision. No I/O, no clock. First failing rule wins.
import type { PolicyConfig } from "./config";
import { fmtUsd } from "./money";

export type Rule =
  | "KILL_SWITCH"
  | "STATE_UNAVAILABLE"
  | "INVALID_AMOUNT"
  | "NO_RECIPIENT"
  | "RECIPIENT_NOT_ALLOWED"
  | "PER_TX_CAP"
  | "DAILY_CAP"
  | "CHANNEL_CAP"
  | "OK";

export interface Proposal {
  recipient: string | null;
  totalCents: bigint;
}

export interface PolicyState {
  killed: boolean;
  /** Spend already committed in the rolling 24h window; null = could not be determined (fail closed). */
  spentTodayCents: bigint | null;
  /** Remaining in the on-chain channel; null = rail has no channel (xrpl/mock without channel). */
  channelRemainingCents: bigint | null;
}

export interface Decision {
  allow: boolean;
  rule: Rule;
  reason: string;
}

const deny = (rule: Rule, reason: string): Decision => ({ allow: false, rule, reason });

export function evaluatePolicy(p: Proposal, cfg: PolicyConfig, s: PolicyState): Decision {
  if (s.killed) return deny("KILL_SWITCH", "Kill switch is ON: all payments are blocked");
  if (s.spentTodayCents === null) return deny("STATE_UNAVAILABLE", "Chain/RPC unreachable (or audit log unreadable): cannot verify live limits, failing closed");
  if (typeof p.totalCents !== "bigint" || p.totalCents <= 0n) return deny("INVALID_AMOUNT", "Amount must be a positive integer");
  if (!p.recipient) return deny("NO_RECIPIENT", "No recipient found in the request");
  const r = cfg.recipients.find((x) => x.alias === p.recipient);
  if (!r) return deny("RECIPIENT_NOT_ALLOWED", `"${p.recipient}" is not on the allow-list`);
  if (p.totalCents > cfg.perTxCapCents)
    return deny("PER_TX_CAP", `${fmtUsd(p.totalCents)} is over the per-payment cap of ${fmtUsd(cfg.perTxCapCents)}`);
  if (s.spentTodayCents + p.totalCents > cfg.dailyCapCents)
    return deny(
      "DAILY_CAP",
      `${fmtUsd(p.totalCents)} would exceed the 24h cap (${fmtUsd(s.spentTodayCents)} of ${fmtUsd(cfg.dailyCapCents)} used)`,
    );
  if (s.channelRemainingCents !== null && p.totalCents > s.channelRemainingCents)
    return deny("CHANNEL_CAP", `${fmtUsd(p.totalCents)} exceeds the prefunded channel balance of ${fmtUsd(s.channelRemainingCents)}`);
  return { allow: true, rule: "OK", reason: "Within per-payment, daily and channel caps; recipient allow-listed" };
}
