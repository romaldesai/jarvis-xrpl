// Integer-only money helpers. No floating point touches amounts.

/** Parse a decimal string ("5,000.50") into integer minor units with `decimals` places. Throws on junk. */
export function parseDecimal(input: string, decimals: number): bigint {
  const s = input.replace(/[,_\s]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not a positive decimal: ${JSON.stringify(input)}`);
  const whole = m[1];
  let frac = m[2] ?? "";
  if (frac.length > decimals) {
    if (/[1-9]/.test(frac.slice(decimals))) throw new Error(`too many decimal places (max ${decimals})`);
    frac = frac.slice(0, decimals);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Format integer minor units as a decimal string with exactly `decimals` places. */
export function formatMinor(v: bigint, decimals: number, opts: { grouping?: "en-US" | "en-IN" } = {}): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (a / base).toString();
  const frac = decimals ? "." + (a % base).toString().padStart(decimals, "0") : "";
  const grouped = opts.grouping ? groupDigits(whole, opts.grouping) : whole;
  return (neg ? "-" : "") + grouped + frac;
}

function groupDigits(s: string, style: "en-US" | "en-IN"): string {
  if (style === "en-US" || s.length <= 3) return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Token base units per US cent for a token with `decimals` (1 token = $1). 18dp -> 10^16, 6dp -> 10^4. */
export function unitsPerCent(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 18) throw new Error("token decimals must be 2..18");
  return 10n ** BigInt(decimals - 2);
}
export const centsToBase = (cents: bigint, decimals: number): bigint => cents * unitsPerCent(decimals);
export const baseToCentsFloor = (base: bigint, decimals: number): bigint => base / unitsPerCent(decimals);

/** Back-compat helpers for an 18-decimal token. */
export const RLUSD_DECIMALS = 18;
export const WEI_PER_CENT = 10n ** 16n;
export const centsToRlusd = (cents: bigint): bigint => cents * WEI_PER_CENT;
export const rlusdToCentsFloor = (wei: bigint): bigint => wei / WEI_PER_CENT;

export const fmtUsd = (cents: bigint) => `$${formatMinor(cents, 2, { grouping: "en-US" })}`;
export const fmtInr = (paise: bigint) => `₹${formatMinor(paise, 2, { grouping: "en-IN" })}`;
export const fmtRlusd = (cents: bigint, label = "RLUSD") => `${formatMinor(cents, 2, { grouping: "en-US" })} ${label}`;
