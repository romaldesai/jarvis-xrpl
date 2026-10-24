import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FxConfig } from "../src/config";
import { _resetFxCache, buildQuote, getUsdInrRate, type Rate } from "../src/quote";

const fx = (over: Partial<FxConfig> = {}): FxConfig => ({
  providers: [
    { name: "frankfurter", url: "https://fx.test/frankfurter" },
    { name: "er-api", url: "https://fx.test/er-api" },
  ],
  staticMicro: 88_000_000n,
  timeoutMs: 200,
  cacheFile: null,
  cacheMaxAgeMs: 24 * 3600 * 1000,
  ...over,
});
const rate: Rate = { micro: 88_000_000n, source: "demo", provider: "static", label: "Demo FX rate", asOf: "t" };
const json = (o: unknown) => new Response(JSON.stringify(o));
const route = (m: Record<string, () => Response>) =>
  (async (url: string) => {
    for (const [k, f] of Object.entries(m)) if (String(url).includes(k)) return f();
    throw new Error("offline");
  }) as unknown as typeof fetch;

beforeEach(() => _resetFxCache());

describe("quote math", () => {
  it("INR intent: USD rounds up, fee added, 18dp base units", () => {
    const q = buildQuote({ currency: "INR", amountMinor: 500000n }, rate, 99n);
    expect(q.usdCents).toBe(5682n); // 5000 / 88 = 56.818 -> 56.82
    expect(q.totalCents).toBe(5781n);
    expect(q.rlusdWei).toBe(5781n * 10n ** 16n);
  });
  it("6-decimal token: 1 cent = 10^4 base units", () => {
    expect(buildQuote({ currency: "INR", amountMinor: 500000n }, rate, 99n, 6).rlusdWei).toBe(57_810_000n);
  });
  it("USD intent: INR rounds down", () => {
    const q = buildQuote({ currency: "USD", amountMinor: 5000n }, { ...rate, micro: 88_123_456n }, 99n);
    expect(q.inrPaise).toBe(440617n);
    expect(q.totalCents).toBe(5099n);
  });
});

describe("FX sources", () => {
  it("primary: frankfurter {rate}", async () => {
    const r = await getUsdInrRate(fx(), route({ frankfurter: () => json({ date: "2026-10-25", base: "USD", quote: "INR", rate: 94.76 }) }));
    expect(r).toMatchObject({ micro: 94_760_000n, source: "live", provider: "frankfurter", label: "Live rate (frankfurter)" });
  });
  it("backup: er-api {rates.INR} when primary fails", async () => {
    const r = await getUsdInrRate(fx(), route({ frankfurter: () => new Response("", { status: 500 }), "er-api": () => json({ rates: { INR: 87.4321 } }) }));
    expect(r).toMatchObject({ micro: 87_432_100n, provider: "er-api", source: "live" });
  });
  it("insane values are ignored", async () => {
    const r = await getUsdInrRate(fx(), route({ frankfurter: () => json({ rate: 0.5 }), "er-api": () => json({ rates: { INR: 9999 } }) }));
    expect(r.source).toBe("demo");
  });
  it("cached last good rate when all providers are down, with timestamp in label", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fx-")), "fx.json");
    const t0 = new Date("2026-10-25T10:00:00Z");
    await getUsdInrRate(fx({ cacheFile: file }), route({ frankfurter: () => json({ rate: 94.76 }) }), t0);
    _resetFxCache(); // simulate restart: file cache only
    const r = await getUsdInrRate(fx({ cacheFile: file }), route({}), new Date("2026-10-25T12:00:00Z"));
    expect(r).toMatchObject({ micro: 94_760_000n, source: "cached" });
    expect(r.label).toContain("2026-10-25 10:00");
  });
  it("stale cache (>24h) falls back to the static Demo FX rate", async () => {
    const t0 = new Date("2026-10-23T10:00:00Z");
    await getUsdInrRate(fx(), route({ frankfurter: () => json({ rate: 94.76 }) }), t0);
    const r = await getUsdInrRate(fx(), route({}), new Date("2026-10-25T12:00:00Z"));
    expect(r).toMatchObject({ micro: 88_000_000n, source: "demo", label: "Demo FX rate" });
  });
  it("offline mode (no providers) uses demo rate", async () => {
    expect((await getUsdInrRate(fx({ providers: [] }))).label).toBe("Demo FX rate");
  });
});
