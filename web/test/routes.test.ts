// Route-handler tests for the web API (prepare / approve / reject / kill).
// The agent is the real RemittanceAgent (real policy + approval gate) on the in-memory MockRail:
// no chain, no network (FX is forced offline to the static demo rate).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MockRail, RemittanceAgent, loadConfig } from "@xrp2india/agent";
import { POST as prepare } from "@/app/api/prepare/route";
import { POST as approve } from "@/app/api/approve/route";
import { POST as reject } from "@/app/api/reject/route";
import { POST as kill } from "@/app/api/kill/route";

const offlineFetch = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

let rail: MockRail;
let agent: RemittanceAgent;
let auditPath: string;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x2i-web-"));
  auditPath = path.join(dir, "audit.jsonl");
  const env = {
    SETTLEMENT_RAIL: "mock",
    AUDIT_LOG_PATH: auditPath,
    KILL_SWITCH: "0",
    KILL_SWITCH_FILE: path.join(dir, "kill.flag"),
    FX_STATIC_USD_INR: "88.00",
    FX_OFFLINE: "1",
  } as NodeJS.ProcessEnv;
  rail = new MockRail(50_000n);
  agent = new RemittanceAgent(loadConfig(env), { rail, fetchImpl: offlineFetch, env });
  // web/lib/agent.ts caches the agent here; inject ours instead of building one from .env.
  (globalThis as { __x2i?: RemittanceAgent }).__x2i = agent;
});

const post = (body: unknown) =>
  new Request("http://127.0.0.1/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function ndjson(res: Response) {
  const lines = (await res.text()).split("\n").filter((l) => l.trim());
  return lines.map((l) => JSON.parse(l));
}

async function prepared(text = "Send ₹5,000 to my mother in India") {
  const res = await prepare(post({ text }));
  expect(res.status).toBe(200);
  return res.json();
}

const events = () => fs.readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l).event as string);

describe("POST /api/prepare", () => {
  it("happy path: ₹5,000 to mother -> awaiting_approval card, nothing moved", async () => {
    const c = await prepared();
    expect(c.status).toBe("awaiting_approval");
    expect(c.id).toEqual(expect.any(String));
    expect(c.quote.inr).toBe("₹5,000.00");
    expect(c.quote.rateLabel).toBe("Demo FX rate");
    expect(c.upiMasked).toBe("•••@okaxis");
    expect(events()).toEqual(["prepare"]);
  });

  it("₹50,000 is rejected by PER_TX_CAP and gets no id", async () => {
    const c = await prepared("Send ₹50,000 to my mother in India");
    expect(c.status).toBe("denied");
    expect(c.id).toBeNull();
    expect(c.decision.rule).toBe("PER_TX_CAP");
    expect(events()).toEqual(["deny"]);
  });

  it("empty or malformed body -> 400 JSON", async () => {
    for (const body of [{ text: "" }, {}, "{not json"]) {
      const res = await prepare(post(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "empty message" });
    }
  });

  it("chain down: fails closed with STATE_UNAVAILABLE", async () => {
    rail.channelState = async () => {
      throw new Error("ECONNREFUSED rpc");
    };
    const c = await prepared();
    expect(c.status).toBe("denied");
    expect(c.decision.rule).toBe("STATE_UNAVAILABLE");
    expect(c.decision.reason).toMatch(/Chain\/RPC unreachable/);
  });
});

describe("POST /api/approve", () => {
  it("happy path: streams approved -> redeemed -> settled, then one ok result with SIMULATED payout", async () => {
    const c = await prepared();
    const res = await approve(post({ id: c.id }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const out = await ndjson(res);
    const steps = out.filter((o) => o.step).map((o) => o.step);
    expect(steps.filter((s) => s === "approved")).toHaveLength(1);
    expect(steps).toEqual(expect.arrayContaining(["approved", "redeemed", "settled"]));
    const results = out.filter((o) => o.result);
    expect(results).toHaveLength(1);
    expect(results[0].result.ok).toBe(true);
    expect(results[0].result.payout.label).toBe("SIMULATED");
    expect(events()).toEqual(["prepare", "approve", "redeem", "settle"]);
  });

  it("missing / non-string id -> clean 400 JSON", async () => {
    for (const body of [{}, { id: 42 }, "{not json"]) {
      const res = await approve(post(body));
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json()).toEqual({ error: "bad id" });
    }
  });

  it("unknown id -> refused (UNKNOWN_OR_USED), nothing signed, no 'approved' step", async () => {
    const out = await ndjson(await approve(post({ id: "00000000-0000-0000-0000-000000000000" })));
    expect(out).toHaveLength(1);
    expect(out[0].result).toMatchObject({ ok: false, rule: "UNKNOWN_OR_USED" });
    expect(fs.existsSync(auditPath) ? events() : []).not.toContain("redeem");
  });

  it("replaying an already-approved id is refused", async () => {
    const c = await prepared();
    await ndjson(await approve(post({ id: c.id })));
    const out = await ndjson(await approve(post({ id: c.id })));
    expect(out.at(-1).result).toMatchObject({ ok: false, rule: "UNKNOWN_OR_USED" });
    expect(events().filter((e) => e === "redeem")).toHaveLength(1);
  });

  it("kill switch (via /api/kill) blocks approve of an already-prepared payment", async () => {
    const c = await prepared();
    const k = await kill(post({ on: true }));
    expect(k.status).toBe(200);
    expect(agent.killed()).toBe(true);
    const out = await ndjson(await approve(post({ id: c.id })));
    expect(out.at(-1).result).toMatchObject({ ok: false, rule: "KILL_SWITCH" });
    expect(events()).not.toContain("redeem");
    await kill(post({ on: false }));
    expect(agent.killed()).toBe(false);
  });

  it("chain down after prepare: approve fails closed, nothing redeemed", async () => {
    const c = await prepared();
    rail.channelState = async () => {
      throw new Error("ECONNREFUSED rpc");
    };
    const out = await ndjson(await approve(post({ id: c.id })));
    expect(out.at(-1).result).toMatchObject({ ok: false, rule: "STATE_UNAVAILABLE" });
    expect(events()).not.toContain("redeem");
  });

  it("an unexpected server error still ends the stream with one {result: ok:false} line", async () => {
    const c = await prepared();
    agent.approve = async () => {
      throw new Error("boom");
    };
    const out = await ndjson(await approve(post({ id: c.id })));
    expect(out).toEqual([{ result: { ok: false, id: c.id, rule: "SERVER_ERROR", error: "boom" } }]);
  });
});

describe("POST /api/reject", () => {
  it("rejects a pending payment; it can no longer be approved", async () => {
    const c = await prepared();
    const res = await reject(post({ id: c.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const out = await ndjson(await approve(post({ id: c.id })));
    expect(out.at(-1).result.ok).toBe(false);
    expect(events()).toContain("reject");
    expect(events()).not.toContain("redeem");
  });

  it("bad id -> 400 JSON; unknown id -> ok:false", async () => {
    const bad = await reject(post({}));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad id" });
    expect(await (await reject(post({ id: "nope" }))).json()).toEqual({ ok: false });
  });
});
