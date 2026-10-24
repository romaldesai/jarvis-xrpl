import { describe, expect, it } from "vitest";
import { evaluatePolicy, type PolicyState } from "../src/policy";

const cfg = { perTxCapCents: 10000n, dailyCapCents: 25000n, recipients: [{ alias: "mother", upiId: "mom.demo@okaxis" }] };
const ok: PolicyState = { killed: false, spentTodayCents: 0n, channelRemainingCents: 50000n };
const ev = (total: bigint, s: Partial<PolicyState> = {}, recipient: string | null = "mother") =>
  evaluatePolicy({ recipient, totalCents: total }, cfg, { ...ok, ...s });

describe("policy engine", () => {
  it("allows a normal payment", () => expect(ev(5781n)).toMatchObject({ allow: true, rule: "OK" }));

  it("per-tx cap: just under / exactly at / just over", () => {
    expect(ev(9999n).allow).toBe(true);
    expect(ev(10000n).allow).toBe(true);
    expect(ev(10001n)).toMatchObject({ allow: false, rule: "PER_TX_CAP" });
  });

  it("daily cap: just under / exactly at / just over", () => {
    expect(ev(5000n, { spentTodayCents: 19999n }).allow).toBe(true);
    expect(ev(5000n, { spentTodayCents: 20000n }).allow).toBe(true);
    expect(ev(5000n, { spentTodayCents: 20001n })).toMatchObject({ allow: false, rule: "DAILY_CAP" });
  });

  it("channel cap: just under / exactly at / just over", () => {
    expect(ev(5000n, { channelRemainingCents: 5001n }).allow).toBe(true);
    expect(ev(5000n, { channelRemainingCents: 5000n }).allow).toBe(true);
    expect(ev(5000n, { channelRemainingCents: 4999n })).toMatchObject({ allow: false, rule: "CHANNEL_CAP" });
  });

  it("no channel (native rail) skips channel rule", () => expect(ev(5000n, { channelRemainingCents: null }).allow).toBe(true));

  it("recipient allow-list", () => {
    expect(ev(100n, {}, "landlord")).toMatchObject({ allow: false, rule: "RECIPIENT_NOT_ALLOWED" });
    expect(ev(100n, {}, null)).toMatchObject({ allow: false, rule: "NO_RECIPIENT" });
  });

  it("invalid amounts", () => {
    expect(ev(0n).rule).toBe("INVALID_AMOUNT");
    expect(ev(-1n).rule).toBe("INVALID_AMOUNT");
  });

  it("kill switch wins over everything", () => expect(ev(100n, { killed: true }).rule).toBe("KILL_SWITCH"));

  it("unknown spend state fails closed", () => expect(ev(100n, { spentTodayCents: null }).rule).toBe("STATE_UNAVAILABLE"));

  it("rule order: kill > state > amount > recipient > per-tx > daily > channel", () => {
    expect(ev(999999n, { spentTodayCents: 999999n, channelRemainingCents: 0n }, "x").rule).toBe("RECIPIENT_NOT_ALLOWED");
    expect(ev(999999n, { spentTodayCents: 999999n, channelRemainingCents: 0n }).rule).toBe("PER_TX_CAP");
    expect(ev(9000n, { spentTodayCents: 999999n, channelRemainingCents: 0n }).rule).toBe("DAILY_CAP");
  });
});
