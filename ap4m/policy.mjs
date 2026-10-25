// XRP2India AP4M lane: autonomous-spend policy.
// The family remittance (₹5,000 to Mom) still needs a human tap.
// Only small, pre-approved data purchases (a corridor FX quote) run autonomously, inside these limits.
import { existsSync, appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_POLICY = Object.freeze({
  // Merchants the agent may pay without asking. Anything else is refused.
  allowlist: [],
  maxPriceRlusd: '0.50', // ceiling per purchase
  channelCapRlusd: '2', // hard cap enforced on-chain by PaymentLedger
  maxPurchasesPerRun: 3, // velocity limit
  quoteMaxAgeSeconds: 300, // buy a new quote only when the cached one is stale
  killSwitchFile: './STOP', // touch this file and the agent stops paying
});

const toMicro = (v) => Math.round(Number(v) * 1e6);

/**
 * Decide whether the agent may autonomously buy.
 * Returns { allow: boolean, reason: string }.
 */
export function decide({ policy, merchantId, priceRlusd, redeemedRlusd, purchasesThisRun, cachedQuoteAgeSeconds, killSwitchOn }) {
  if (killSwitchOn) return { allow: false, reason: 'KILL_SWITCH: operator stop file present' };
  if (cachedQuoteAgeSeconds != null && cachedQuoteAgeSeconds < policy.quoteMaxAgeSeconds)
    return { allow: false, reason: `NOT_NEEDED: cached quote is ${cachedQuoteAgeSeconds}s old (< ${policy.quoteMaxAgeSeconds}s)` };
  if (!policy.allowlist.map((m) => m.toLowerCase()).includes(String(merchantId).toLowerCase()))
    return { allow: false, reason: 'MERCHANT_NOT_ALLOWLISTED' };
  if (toMicro(priceRlusd) <= 0) return { allow: false, reason: 'INVALID_PRICE' };
  if (toMicro(priceRlusd) > toMicro(policy.maxPriceRlusd))
    return { allow: false, reason: `PRICE_ABOVE_CEILING: ${priceRlusd} > ${policy.maxPriceRlusd} RLUSD` };
  if (toMicro(redeemedRlusd) + toMicro(priceRlusd) > toMicro(policy.channelCapRlusd))
    return { allow: false, reason: `CHANNEL_CAP: ${redeemedRlusd} + ${priceRlusd} > ${policy.channelCapRlusd} RLUSD` };
  if (purchasesThisRun >= policy.maxPurchasesPerRun)
    return { allow: false, reason: `VELOCITY: ${purchasesThisRun} purchases already this run` };
  return { allow: true, reason: 'WITHIN_POLICY' };
}

export const killSwitchOn = (policy) => existsSync(policy.killSwitchFile);

export function audit(file, event) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
}

/** Load KEY=VALUE pairs from an untracked .env into process.env (never printed). */
export function loadEnv(path = process.env.ENV_FILE || '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 1 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
