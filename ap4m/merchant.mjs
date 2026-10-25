// XRP2India Corridor Quote Merchant (AP4M x402 seller).
// Sells a USD->INR corridor quote for a small RLUSD price. Agents pay with an EIP-712 Voucher over x402;
// this server redeems each Voucher on-chain and releases the quote.
//
// Env (untracked .env): MERCHANT_PRIVATE_KEY (submitter, needs XRP gas), MERCHANT_ID, MERCHANT_ADDRESS (payout)
import { ethers } from 'ethers';
import { createX402Merchant, loadX402Context } from './ap4m-x402.mjs';
import { loadEnv } from './policy.mjs';

loadEnv();
const AP4M_API_URL = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';
const PRICE_RLUSD = process.env.PRICE_RLUSD || '0.25';
const PORT = Number(process.env.PORT || 4308);
const RESOURCE_URL = process.env.RESOURCE_URL || `http://127.0.0.1:${PORT}/resource`;
const { MERCHANT_PRIVATE_KEY, MERCHANT_ID, MERCHANT_ADDRESS } = process.env;

async function liveQuote() {
  // Reference mid-market rate (ECB-sourced via Frankfurter). Not an executable payout rate.
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR');
    const j = await r.json();
    if (j?.rates?.INR) return { rate: j.rates.INR, rateDate: j.date, source: 'frankfurter.dev (ECB reference)' };
  } catch {}
  return { rate: Number(process.env.FALLBACK_USD_INR || '94.76'), rateDate: null, source: 'fallback (offline)' };
}

async function main() {
  if (!MERCHANT_PRIVATE_KEY || !MERCHANT_ID || !MERCHANT_ADDRESS) {
    console.error('Set MERCHANT_PRIVATE_KEY, MERCHANT_ID and MERCHANT_ADDRESS in .env');
    process.exit(1);
  }
  const context = await loadX402Context(AP4M_API_URL);
  const config = await (await fetch(`${AP4M_API_URL}/public/config`)).json();
  const provider = new ethers.JsonRpcProvider(process.env.AP4M_RPC_URL || config.network.rpcUrl);
  const q = await liveQuote();
  const content = {
    product: 'XRP2India corridor quote',
    corridor: 'USD -> INR (US to India, UPI payout)',
    midMarketRate: String(q.rate),
    rateDate: q.rateDate,
    rateSource: q.source,
    railFeeUsd: "0.99",
    quotedAt: new Date().toISOString(),
    validForSeconds: 300,
    upiPayout: 'SIMULATED in this demo',
  };
  const merchant = createX402Merchant({
    context,
    provider,
    submitter: new ethers.Wallet(MERCHANT_PRIVATE_KEY, provider),
    // The SDK fingerprints the store with the resource content (live rate + quotedAt), so a reused
    // directory refuses to start after any restart. Default to a fresh per-start folder (gitignored).
    stateDirectory: process.env.MERCHANT_STATE_DIR || `./merchant-state/run-${Date.now()}`,
    resourceUrl: RESOURCE_URL,
    merchantParticipantId: MERCHANT_ID,
    payout: MERCHANT_ADDRESS,
    amount: ethers.parseUnits(PRICE_RLUSD, 18).toString(),
    content,
  });
  merchant.server.listen(PORT, '127.0.0.1', () =>
    console.log(`Corridor Quote Merchant selling ${RESOURCE_URL} for ${PRICE_RLUSD} RLUSD (rate ${q.rate} INR/USD)`));
  for (const s of ['SIGINT', 'SIGTERM']) process.once(s, () => merchant.close().finally(() => process.exit(0)));
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
