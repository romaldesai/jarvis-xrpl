// Clean functional API for UIs and other lanes. Everything here is safe to call from a server process;
// keys never leave it. See README "Agent API".
import { AuditLog, type AuditEvent } from "./audit";
import type { AppConfig } from "./config";
import { createAgentFromEnv } from "./factory";
import { parseIntent as parseIntentImpl, type Intent } from "./intent";
import { isKillSwitchOn, setKillSwitch } from "./killswitch";
import { evaluatePolicy as evaluatePolicyImpl, type Decision, type PolicyState, type Proposal } from "./policy";
import { buildQuote, getUsdInrRate, type Quote } from "./quote";
import type { ApprovedAction } from "./approval";
import type { ApproveResult, Budget, PaymentCard, RemittanceAgent } from "./service";

let singleton: RemittanceAgent | null = null;

/** The process-wide agent (built from .env + contracts/deployments on first use). */
export function getAgent(): RemittanceAgent {
  return (singleton ??= createAgentFromEnv());
}

/** For tests or custom wiring. */
export function setAgent(a: RemittanceAgent | null) {
  singleton = a;
}

/** 1. Text -> untrusted intent (LLM if configured, deterministic regex fallback). Null if no amount found. */
export function parseIntent(text: string, llm?: AppConfig["llm"]): Promise<Intent | null> {
  return parseIntentImpl(text, llm ?? getAgent().cfg.llm);
}

/** 2. Pure policy decision. */
export function evaluatePolicy(p: Proposal, cfg: AppConfig["policy"], state: PolicyState): Decision {
  return evaluatePolicyImpl(p, cfg, state);
}

/** 3. FX + fee quote for an intent (live -> cached -> "Demo FX rate"). */
export async function quote(intent: Pick<Intent, "currency" | "amountMinor">, cfg: AppConfig = getAgent().cfg): Promise<Quote> {
  const rate = await getUsdInrRate(cfg.fx);
  return buildQuote(intent, rate, cfg.feeCents, cfg.token.decimals);
}

/** 1-3 in one call: parse + quote + policy, registers a pending payment. Nothing moves. */
export function prepare(text: string): Promise<PaymentCard> {
  return getAgent().prepare(text);
}

/** 4. Human approved: re-check policy, mint the typed single-use ApprovedAction. Throws ApprovalError(rule). */
export function approve(id: string): Promise<ApprovedAction> {
  return getAgent().approveAction(id);
}

/** 5. Sign EIP-712 voucher -> redeemVoucher -> settle (or XRPL Payment). Returns proofs + SIMULATED payout. */
export function redeemAndSettle(action: ApprovedAction, onStep?: (step: string, d?: Record<string, unknown>) => void): Promise<ApproveResult> {
  return getAgent().redeemAndSettle(action, onStep);
}

/** Human rejected. */
export function reject(id: string) {
  return getAgent().reject(id);
}

/** CONTROL numbers: caps, remaining, channel. */
export function budget(): Promise<Budget> {
  return getAgent().budget();
}

/** Newest-last audit events. */
export function readAudit(n = 50, file?: string): AuditEvent[] {
  return file ? new AuditLog(file).tail(n) : getAgent().auditTail(n);
}

/** Kill switch (signer-side). Ledger-side: PaymentLedger.pause(). */
export const killSwitch = {
  isOn: (): boolean => getAgent().killed(),
  set: (on: boolean): { killed: boolean } => getAgent().setKill(on),
  /** Without building an agent (e.g. before deploy). */
  isOnRaw: isKillSwitchOn,
  setRaw: setKillSwitch,
};
