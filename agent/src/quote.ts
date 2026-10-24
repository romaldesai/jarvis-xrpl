import fs from "node:fs";
import type { FxConfig } from "./config";
import { ceilDiv, centsToBase, parseDecimal } from "./money";
import type { Intent } from "./intent";

export interface Rate {
  /** INR per 1 USD, scaled by 10^6 (integer). */
  micro: bigint;
  /** live = fetched now; cached = last good live rate (< 24h old); demo = static fallback. */
  source: "live" | "cached" | "demo";
  provider: string; // "frankfurter" | "er-api" | "static"
  label: string; // human label for the UI, e.g. "Live rate (frankfurter)" or "Demo FX rate"
  asOf: string;
}

export interface Quote {
  inrPaise: bigint; // what the recipient gets (simulated payout)
  usdCents: bigint; // principal in USD
  feeCents: bigint;
  totalCents: bigint; // principal + fee = what the voucher spends
  /** totalCents in token base units (decimals from config). Named for back-compat. */
  rlusdWei: bigint;
  rate: Rate;
}

const MIN_RATE = 50_000_000n; // 50 INR/USD sanity floor
const MAX_RATE = 150_000_000n; // 150 INR/USD sanity ceiling

let memCache: Rate | null = null;

function extractInr(provider: string, body: any): number | undefined {
  if (provider === "frankfurter") return typeof body?.rate === "number" ? body.rate : body?.rates?.INR;
  return body?.rates?.INR;
}

function readCache(fx: FxConfig, now: Date): Rate | null {
  let c = memCache;
  if (!c && fx.cacheFile) {
    try {
      const j = JSON.parse(fs.readFileSync(fx.cacheFile, "utf8"));
      c = { micro: BigInt(j.micro), source: "live", provider: j.provider, label: "", asOf: j.asOf };
    } catch {
      c = null;
    }
  }
  if (!c || now.getTime() - Date.parse(c.asOf) > fx.cacheMaxAgeMs || c.micro < MIN_RATE || c.micro > MAX_RATE) return null;
  return { ...c, source: "cached", label: `Cached rate (${c.provider}, ${c.asOf.slice(0, 16).replace("T", " ")} UTC)` };
}

function writeCache(fx: FxConfig, r: Rate) {
  memCache = r;
  if (!fx.cacheFile) return;
  try {
    fs.writeFileSync(fx.cacheFile, JSON.stringify({ micro: r.micro.toString(), provider: r.provider, asOf: r.asOf }) + "\n");
  } catch {
    /* cache is best effort */
  }
}

/** Test hook. */
export function _resetFxCache() {
  memCache = null;
}

/** USD->INR: providers in order, then last good cached rate, then the static "Demo FX rate". Never throws. */
export async function getUsdInrRate(fx: FxConfig, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<Rate> {
  for (const p of fx.providers) {
    try {
      const res = await fetchImpl(p.url, { signal: AbortSignal.timeout(fx.timeoutMs) });
      if (!res.ok) continue;
      const inr = extractInr(p.name, await res.json());
      if (typeof inr !== "number" || !isFinite(inr)) continue;
      const micro = parseDecimal(inr.toFixed(6), 6);
      if (micro < MIN_RATE || micro > MAX_RATE) continue;
      const r: Rate = { micro, source: "live", provider: p.name, label: `Live rate (${p.name})`, asOf: now.toISOString() };
      writeCache(fx, r);
      return r;
    } catch {
      /* try next */
    }
  }
  return readCache(fx, now) ?? { micro: fx.staticMicro, source: "demo", provider: "static", label: "Demo FX rate", asOf: now.toISOString() };
}

export function buildQuote(intent: Pick<Intent, "currency" | "amountMinor">, rate: Rate, feeCents: bigint, tokenDecimals = 18): Quote {
  let inrPaise: bigint;
  let usdCents: bigint;
  if (intent.currency === "INR") {
    inrPaise = intent.amountMinor;
    usdCents = ceilDiv(inrPaise * 1_000_000n, rate.micro); // round up: sender never under-funds
  } else {
    usdCents = intent.amountMinor;
    inrPaise = (usdCents * rate.micro) / 1_000_000n; // round down: never over-promise
  }
  const totalCents = usdCents + feeCents;
  return { inrPaise, usdCents, feeCents, totalCents, rlusdWei: centsToBase(totalCents, tokenDecimals), rate };
}
