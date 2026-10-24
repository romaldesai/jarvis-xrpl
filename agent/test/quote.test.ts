import { describe, expect, it } from "vitest";
import { buildQuote, getUsdInrRate } from "../src/quote";

const fx = { apiUrl: "https://fx.test/usd", staticMicro: 88_000_000n, timeoutMs: 200 };
const rate = { micro: 88_000_000n, source: "static" as const, asOf: "t" };

describe("quote", () => {
  it("INR intent: USD rounds up, fee added, RLUSD in 18dp", () => {
    const q = buildQuote({ currency: "INR", amountMinor: 500000n }, rate, 99n);
    expect(q.usdCents).toBe(5682n); // 5000 / 88 = 56.818 -> 56.82
    expect(q.totalCents).toBe(5781n);
    expect(q.rlusdWei).toBe(5781n * 10n ** 16n);
    expect(q.inrPaise).toBe(500000n);
  });
  it("USD intent: INR rounds down", () => {
    const q = buildQuote({ currency: "USD", amountMinor: 5000n }, { ...rate, micro: 88_123_456n }, 99n);
    expect(q.inrPaise).toBe(440617n); // 50 * 88.123456 = 4406.1728
    expect(q.totalCents).toBe(5099n);
  });
  it("uses live rate when sane", async () => {
    const f = (async () => new Response(JSON.stringify({ rates: { INR: 87.4321 } }))) as unknown as typeof fetch;
    const r = await getUsdInrRate(fx, f);
    expect(r).toMatchObject({ micro: 87_432_100n, source: "live" });
  });
  it("falls back to static on error, bad body, or insane rate", async () => {
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const junk = (async () => new Response("{}")) as unknown as typeof fetch;
    const insane = (async () => new Response(JSON.stringify({ rates: { INR: 0.5 } }))) as unknown as typeof fetch;
    for (const f of [boom, junk, insane]) expect((await getUsdInrRate(fx, f)).source).toBe("static");
    expect((await getUsdInrRate({ ...fx, apiUrl: null })).micro).toBe(88_000_000n);
  });
});
