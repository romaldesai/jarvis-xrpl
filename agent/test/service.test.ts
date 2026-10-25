import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ApprovalGate, type ApprovedAction } from "../src/approval";
import { AuditLog } from "../src/audit";
import { loadConfig } from "../src/config";
import { MockRail } from "../src/rails/mock";
import { RemittanceAgent, maskUpi } from "../src/service";

const offlineFetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

function setup(extraEnv: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x2i-"));
  const env = {
    SETTLEMENT_RAIL: "mock",
    AUDIT_LOG_PATH: path.join(dir, "audit.jsonl"),
    KILL_SWITCH: "0",
    KILL_SWITCH_FILE: path.join(dir, "kill.flag"),
    FX_STATIC_USD_INR: "88.00",
    FX_OFFLINE: "1",
    ...extraEnv,
  };
  const cfg = loadConfig(env as NodeJS.ProcessEnv);
  const rail = new MockRail(50_000n);
  const agent = new RemittanceAgent(cfg, { rail, fetchImpl: offlineFetch, env: env as NodeJS.ProcessEnv });
  return { agent, rail, env, dir, audit: new AuditLog(env.AUDIT_LOG_PATH) };
}

describe("RemittanceAgent end to end (mock rail)", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it("happy path: prepare -> approve -> settle, fully audited", async () => {
    const card = await t.agent.prepare("Send ₹5,000 to my mother in India");
    expect(card.status).toBe("awaiting_approval");
    expect(card.quote?.total).toBe("$57.81");
    expect(card.upiMasked).toBe("•••@okaxis");
    expect(t.audit.read().map((e) => e.event)).toEqual(["prepare"]); // nothing moved yet

    const res = await t.agent.approve(card.id!);
    expect(res.ok).toBe(true);
    expect(res.settlement?.proofs.map((p) => p.step)).toEqual(["redeemVoucher", "settle"]);
    expect(res.payout?.label).toBe("SIMULATED");
    expect(res.payout?.amountInr).toBe("₹5,000.00");
    expect(res.budget.spentTodayCents).toBe("5781");
    expect(res.budget.channel?.remainingCents).toBe(String(50_000 - 5781));
    expect(t.audit.read().map((e) => e.event)).toEqual(["prepare", "approve", "redeem", "settle"]);
    expect(t.audit.read().every((e) => e.ts)).toBe(true);
  });

  it("over per-tx cap is denied and never reaches approval", async () => {
    const card = await t.agent.prepare("Send ₹10,000 to my brother");
    expect(card).toMatchObject({ status: "denied", id: null });
    expect(card.decision.rule).toBe("PER_TX_CAP");
    expect(t.audit.read().at(-1)).toMatchObject({ event: "deny", rule: "PER_TX_CAP" });
  });

  it("unknown recipient is denied", async () => {
    const card = await t.agent.prepare("Send ₹500 to my landlord");
    expect(card.decision.rule).toBe("RECIPIENT_NOT_ALLOWED");
  });

  it("gibberish is not understood", async () => {
    expect((await t.agent.prepare("what's the weather")).status).toBe("not_understood");
  });

  it("daily cap is enforced across payments (state from audit log)", async () => {
    for (let i = 0; i < 4; i++) {
      const c = await t.agent.prepare("Send ₹5,000 to my mother");
      expect(c.status).toBe("awaiting_approval");
      expect((await t.agent.approve(c.id!)).ok).toBe(true);
    }
    const c5 = await t.agent.prepare("Send ₹5,000 to my mother");
    expect(c5.decision.rule).toBe("DAILY_CAP"); // 4 x 57.81 = 231.24; +57.81 > 250
  });

  it("daily spend survives a restart (new agent, same audit file)", async () => {
    const c = await t.agent.prepare("Send ₹5,000 to my mother");
    await t.agent.approve(c.id!);
    const again = new RemittanceAgent(t.agent.cfg, { rail: new MockRail(), fetchImpl: offlineFetch, env: t.env as NodeJS.ProcessEnv });
    expect((await again.budget()).spentTodayCents).toBe("5781");
  });

  it("kill switch between prepare and approve blocks settlement", async () => {
    const card = await t.agent.prepare("Send ₹5,000 to my mother");
    t.agent.setKill(true);
    const res = await t.agent.approve(card.id!);
    expect(res).toMatchObject({ ok: false, rule: "KILL_SWITCH" });
    expect(t.audit.read().map((e) => e.event)).not.toContain("settle");
    t.agent.setKill(false);
    expect((await t.agent.prepare("Send ₹5,000 to my mother")).status).toBe("awaiting_approval");
  });

  it("env KILL_SWITCH=1 blocks prepare", async () => {
    const k = setup({ KILL_SWITCH: "1" });
    expect((await k.agent.prepare("Send ₹5,000 to my mother")).decision.rule).toBe("KILL_SWITCH");
  });

  it("approve is single-use; reject removes the pending item", async () => {
    const card = await t.agent.prepare("Send ₹5,000 to my mother");
    expect((await t.agent.approve(card.id!)).ok).toBe(true);
    expect((await t.agent.approve(card.id!)).rule).toBe("UNKNOWN_OR_USED");
    const c2 = await t.agent.prepare("Send ₹5,000 to my mother");
    expect(t.agent.reject(c2.id!).ok).toBe(true);
    expect((await t.agent.approve(c2.id!)).ok).toBe(false);
    expect(t.audit.read().some((e) => e.event === "reject")).toBe(true);
  });

  it("progress stream: 'approved' is emitted once on success and never for a refused approval", async () => {
    const card = await t.agent.prepare("Send ₹5,000 to my mother");
    const ok: string[] = [];
    expect((await t.agent.approve(card.id!, (s) => ok.push(s))).ok).toBe(true);
    expect(ok.filter((s) => s === "approved")).toHaveLength(1);
    expect(ok[0]).toBe("approved");
    const replay: string[] = [];
    expect((await t.agent.approve(card.id!, (s) => replay.push(s))).rule).toBe("UNKNOWN_OR_USED");
    expect(replay).toEqual([]);
  });

  it("concurrent approvals cannot jointly exceed the daily cap", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await t.agent.prepare("Send ₹5,000 to my mother")).id!);
    const results = await Promise.all(ids.map((id) => t.agent.approve(id)));
    expect(results.filter((r) => r.ok).length).toBe(4);
    expect(results.find((r) => !r.ok)?.rule).toBe("DAILY_CAP");
  });

  it("settlement failure is audited and releases the daily budget", async () => {
    t.rail.setFailNext();
    const card = await t.agent.prepare("Send ₹5,000 to my mother");
    const res = await t.agent.approve(card.id!);
    expect(res).toMatchObject({ ok: false, rule: "SETTLEMENT_FAILED" });
    expect(res.budget.spentTodayCents).toBe("0");
  });

  it("expired approvals are refused", async () => {
    let now = new Date("2026-10-24T12:00:00Z");
    const cfg = t.agent.cfg;
    const a = new RemittanceAgent(cfg, { rail: new MockRail(), fetchImpl: offlineFetch, env: t.env as NodeJS.ProcessEnv, now: () => now });
    const c = await a.prepare("Send ₹5,000 to my mother");
    now = new Date(now.getTime() + 11 * 60 * 1000);
    expect((await a.approve(c.id!)).rule).toBe("EXPIRED");
  });

  it("audit log never contains secrets", async () => {
    const c = await t.agent.prepare("Send ₹5,000 to my mother");
    await t.agent.approve(c.id!);
    const raw = fs.readFileSync(t.env.AUDIT_LOG_PATH, "utf8");
    expect(raw).not.toMatch(/0x[0-9a-f]{64}"?,"?(key|seed)/i);
    expect(() => t.audit.append({ event: "prepare", privateKey: "x" } as any)).toThrow(/refusing/);
  });

  it("chain RPC down fails closed: no new card, and a prepared payment cannot be approved", async () => {
    const card = await t.agent.prepare("Send ₹5,000 to my mother");
    expect(card.status).toBe("awaiting_approval");
    t.rail.channelState = async () => { throw new Error("ECONNREFUSED rpc"); };
    const denied = (await t.agent.prepare("Send ₹5,000 to my mother")).decision;
    expect(denied.rule).toBe("STATE_UNAVAILABLE");
    expect(denied.reason).toMatch(/Chain\/RPC unreachable/);
    const res = await t.agent.approve(card.id!);
    expect(res.ok).toBe(false);
    expect(res.rule).toBe("STATE_UNAVAILABLE");
    expect(t.audit.read().some((e) => e.event === "redeem")).toBe(false);
  });

  it("corrupt audit log fails closed", async () => {
    fs.appendFileSync(t.env.AUDIT_LOG_PATH, "{not json\n");
    expect((await t.agent.prepare("Send ₹5,000 to my mother")).decision.rule).toBe("STATE_UNAVAILABLE");
  });
});

describe("approval gate", () => {
  it("rails refuse actions the gate did not issue (forged object)", () => {
    const gate = new ApprovalGate();
    const forged = { id: "x", totalCents: 1n } as unknown as ApprovedAction;
    expect(gate.consume(forged)).toBe(false);
  });
  it("issued actions are frozen and consumable once", () => {
    const gate = new ApprovalGate();
    const q = { inrPaise: 1n, usdCents: 1n, feeCents: 0n, totalCents: 1n, rlusdWei: 1n, rate: { micro: 1n, source: "demo" as const, provider: "static", label: "Demo FX rate", asOf: "" } };
    const p = gate.prepare({ recipient: "mother", upiId: "a@b", quote: q });
    const a = gate.approve(p.id, () => ({ allow: true, rule: "OK", reason: "" }));
    expect(Object.isFrozen(a)).toBe(true);
    expect(gate.consume(a)).toBe(true);
    expect(gate.consume(a)).toBe(false);
  });
  it("maskUpi hides the handle", () => expect(maskUpi("mom.demo@okaxis")).toBe("•••@okaxis"));
});

describe("accounting edge: redeem succeeded but settle failed", () => {
  it("keeps the spend counted (money is committed on-chain)", async () => {
    const t = setup();
    class HalfRail extends MockRail {
      async execute(action: ApprovedAction, guard: any, onStep: any = () => {}): Promise<never> {
        guard.assertMaySign(action);
        onStep("redeemed", { txHash: "0xabc" });
        throw new Error("settle reverted");
      }
    }
    const a = new RemittanceAgent(t.agent.cfg, { rail: new HalfRail(), fetchImpl: offlineFetch, env: t.env as NodeJS.ProcessEnv });
    const c = await a.prepare("Send ₹5,000 to my mother");
    const r = await a.approve(c.id!);
    expect(r.ok).toBe(false);
    expect(r.budget.spentTodayCents).toBe("5781");
    expect(t.audit.read().map((e) => e.event)).toEqual(["prepare", "approve", "redeem", "fail"]);
  });
});

describe("split API: approveAction -> redeemAndSettle", () => {
  it("mints a typed action, then settles it exactly once", async () => {
    const t = setup();
    const c = await t.agent.prepare("Send ₹5,000 to my mother");
    const action = await t.agent.approveAction(c.id!);
    expect(action.totalCents).toBe(5781n);
    expect(t.audit.read().map((e) => e.event)).toEqual(["prepare", "approve"]); // nothing moved yet
    const r1 = await t.agent.redeemAndSettle(action);
    expect(r1.ok).toBe(true);
    const r2 = await t.agent.redeemAndSettle(action);
    expect(r2).toMatchObject({ ok: false, rule: "NOT_APPROVED" });
  });
  it("approveAction throws ApprovalError with the policy rule", async () => {
    const t = setup();
    const c = await t.agent.prepare("Send ₹5,000 to my mother");
    t.agent.setKill(true);
    await expect(t.agent.approveAction(c.id!)).rejects.toMatchObject({ rule: "KILL_SWITCH" });
  });
  it("quote carries token label + FX label", async () => {
    const t = setup();
    const c = await t.agent.prepare("Send ₹50,000 to my mother");
    expect(c.decision.rule).toBe("PER_TX_CAP");
    expect(c.quote?.rlusd).toContain("mock RLUSD");
    expect(c.quote?.rateLabel).toBe("Demo FX rate");
  });
  it("RLUSD_DECIMALS=6 changes base units, not dollars", async () => {
    const t = setup({ RLUSD_DECIMALS: "6" });
    const c = await t.agent.prepare("Send ₹5,000 to my mother");
    expect(c.quote?.rlusdWei).toBe("57810000");
    expect(c.quote?.total).toBe("$57.81");
  });
});
