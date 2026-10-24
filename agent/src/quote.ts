import { ceilDiv, centsToRlusd, parseDecimal } from "./money";
import type { Intent } from "./intent";

export interface Rate {
  /** INR per 1 USD, scaled by 10^6 (integer). */
  micro: bigint;
  source: "live" | "static";
  asOf: string;
}

export interface Quote {
  inrPaise: bigint; // what the recipient gets (simulated payout)
  usdCents: bigint; // principal in USD
  feeCents: bigint;
  totalCents: bigint; // principal + fee = what the voucher spends
  rlusdWei: bigint; // totalCents in RLUSD base units (18 dp)
  rate: Rate;
}

const MIN_RATE = 50_000_000n; // 50 INR/USD sanity floor
const MAX_RATE = 150_000_000n; // 150 INR/USD sanity ceiling

/** Live USD->INR with static fallback. Never throws. */
export async function getUsdInrRate(
  fx: { apiUrl: string | null; staticMicro: bigint; timeoutMs: number },
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<Rate> {
  const fallback: Rate = { micro: fx.staticMicro, source: "static", asOf: now.toISOString() };
  if (!fx.apiUrl) return fallback;
  try {
    const res = await fetchImpl(fx.apiUrl, { signal: AbortSignal.timeout(fx.timeoutMs) });
    if (!res.ok) return fallback;
    const body = (await res.json()) as { rates?: Record<string, number>; time_last_update_utc?: string };
    const inr = body?.rates?.INR;
    if (typeof inr !== "number" || !isFinite(inr)) return fallback;
    const micro = parseDecimal(inr.toFixed(6), 6);
    if (micro < MIN_RATE || micro > MAX_RATE) return fallback;
    return { micro, source: "live", asOf: body.time_last_update_utc ?? now.toISOString() };
  } catch {
    return fallback;
  }
}

export function buildQuote(intent: Pick<Intent, "currency" | "amountMinor">, rate: Rate, feeCents: bigint): Quote {
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
  return { inrPaise, usdCents, feeCents, totalCents, rlusdWei: centsToRlusd(totalCents), rate };
}
