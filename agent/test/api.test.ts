import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { api, loadConfig, MockRail, RemittanceAgent } from "../src/index";

describe("api facade", () => {
  it("prepare -> approve -> redeemAndSettle -> readAudit, plus kill switch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x2i-api-"));
    const env = { SETTLEMENT_RAIL: "mock", AUDIT_LOG_PATH: path.join(dir, "a.jsonl"), KILL_SWITCH: "0", KILL_SWITCH_FILE: path.join(dir, "k"), FX_OFFLINE: "1" };
    api.setAgent(new RemittanceAgent(loadConfig(env as NodeJS.ProcessEnv), { rail: new MockRail(), env: env as NodeJS.ProcessEnv }));
    const card = await api.prepare("Send ₹5,000 to my mother in India");
    expect(card.status).toBe("awaiting_approval");
    const action = await api.approve(card.id!);
    const res = await api.redeemAndSettle(action);
    expect(res.ok).toBe(true);
    expect(api.readAudit(10).map((e) => e.event)).toEqual(["prepare", "approve", "redeem", "settle"]);
    expect((await api.budget()).display.dailyRemaining).toBe("$192.19");
    api.killSwitch.set(true);
    expect(api.killSwitch.isOn()).toBe(true);
    const c2 = await api.prepare("Send ₹100 to my mother");
    expect(c2.decision.rule).toBe("KILL_SWITCH");
    api.killSwitch.set(false);
    const intent = await api.parseIntent("send $20 to bhai");
    expect(intent?.recipient).toBe("brother");
    const q = await api.quote(intent!);
    expect(q.totalCents).toBe(2099n);
    api.setAgent(null);
  });
});
