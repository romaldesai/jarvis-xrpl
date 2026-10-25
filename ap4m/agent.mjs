// XRP2India AP4M agent: autonomous, bounded micro-payment.
//
// Story: before preparing "Send ₹5,000 to Mom", the remittance agent needs a fresh USD->INR corridor quote.
// It buys that quote from the Corridor Quote Merchant over x402 WITHOUT asking the user, because the purchase
// is allowlisted, priced under the ceiling, and inside a funded AP4M channel whose cap PaymentLedger enforces.
// The remittance itself still waits for the user's tap (unchanged XRP2India approval gate).
//
// Env (untracked .env): AGENT_PRIVATE_KEY (or EVM_PRIVATE_KEY), MERCHANT_ID
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import sdk from './ap4m-hackathon-sdk.cjs';
import { buyResource, loadX402Context } from './ap4m-x402.mjs';
import { DEFAULT_POLICY, decide, killSwitchOn, audit, loadEnv } from './policy.mjs';

loadEnv();
const { signIn, requestChannel, listChannels, getChannelState, settle, closeChannel } = sdk;
const API = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';
const TEAM = process.env.TEAM_NAME || 'RomsCoin';
const RESOURCE_URL = process.env.RESOURCE_URL || 'http://127.0.0.1:4308/resource';
const AUDIT = process.env.AUDIT_FILE || './out/audit.jsonl';
const KEY = process.env.AGENT_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;
const SEND_INR = Number(process.env.SEND_INR || 5000);

const policy = { ...DEFAULT_POLICY, allowlist: [MERCHANT_ID].filter(Boolean) };
const fmt = (wei) => ethers.formatUnits(wei, 18);

async function probePrice(channelId) {
  const r = await fetch(RESOURCE_URL, { headers: { 'X-AP4M-CHANNEL-ID': channelId } });
  if (r.status !== 402) throw new Error(`expected HTTP 402 from merchant, got ${r.status}`);
  const req = JSON.parse(Buffer.from(r.headers.get('PAYMENT-REQUIRED') || '', 'base64').toString('utf8'));
  return { amountWei: BigInt(req.accepts[0].amount), payTo: req.accepts[0].payTo };
}

async function main() {
  if (!KEY || !MERCHANT_ID) throw new Error('Set AGENT_PRIVATE_KEY and MERCHANT_ID in .env');
  const config = await (await fetch(`${API}/public/config`)).json();
  const provider = new ethers.JsonRpcProvider(process.env.AP4M_RPC_URL || config.network.rpcUrl);
  const wallet = new ethers.Wallet(KEY, provider);
  const ledger = config.contracts?.paymentLedger || config.paymentLedger || process.env.PAYMENT_LEDGER;
  const context = await loadX402Context(API);
  const out = { agent: wallet.address, merchantId: MERCHANT_ID, team: TEAM, steps: [] };
  const step = (name, data = {}) => { out.steps.push({ name, at: new Date().toISOString(), ...data }); audit(AUDIT, { name, ...data }); console.log(`• ${name}`, Object.keys(data).length ? JSON.stringify(data) : ''); };

  if (killSwitchOn(policy)) { step('KILL_SWITCH_ACTIVE', { file: policy.killSwitchFile }); return; }

  const { token } = await signIn(API, TEAM, wallet);
  step('signed_in', { kya: 'agent registered in ParticipantRegistry via AP4M portal' });

  let channel = (await listChannels(API, token)).find((c) => c.channel_status === 'open' && c.merchant_id?.toLowerCase() === MERCHANT_ID.toLowerCase());
  if (!channel) {
    channel = await requestChannel(API, token, wallet, { capRlusd: policy.channelCapRlusd, merchantId: MERCHANT_ID });
    step('channel_opened', { channelId: channel.channel_id, capRlusd: policy.channelCapRlusd });
  } else step('channel_reused', { channelId: channel.channel_id, capRlusd: fmt(channel.cap_wei) });
  const channelId = channel.channel_id;
  out.channelId = channelId;

  // Resume an unfinished purchase (same signed Voucher) instead of paying twice.
  let operation = null;
  if (existsSync('./agent-state/purchase.json')) {
    const prev = JSON.parse(readFileSync('./agent-state/purchase.json', 'utf8'));
    if (!prev.complete && prev.intent.channelId === channelId) { operation = prev.intent.operation; step('resuming_unfinished_purchase', { operation }); }
  }
  if (!operation) {
    const state = await getChannelState(provider, ledger, channelId);
    const { amountWei } = await probePrice(channelId);
    step('http_402_received', { priceRlusd: fmt(amountWei), redeemedRlusd: fmt(state.redeemed), capRlusd: fmt(state.cap) });
    const verdict = decide({
      policy: { ...policy, channelCapRlusd: fmt(state.cap) },
      merchantId: MERCHANT_ID,
      priceRlusd: fmt(amountWei),
      redeemedRlusd: fmt(state.redeemed),
      purchasesThisRun: 0,
      cachedQuoteAgeSeconds: null,
      killSwitchOn: killSwitchOn(policy),
    });
    step('policy_decision', verdict);
    if (!verdict.allow) { writeOut(out); return; }
    operation = `quote-${Date.now()}`;
  }
  let purchase;
  for (let attempt = 1; ; attempt++) {
    try {
      purchase = await buyResource({
        context, provider, wallet, stateDirectory: './agent-state', resourceUrl: RESOURCE_URL, channelId,
        maximumAmount: ethers.parseUnits(policy.maxPriceRlusd, 18).toString(), operation,
      });
      break;
    } catch (e) {
      if (attempt >= 6 || !/HTTP 503|retry|resume/i.test(String(e.message))) throw e;
      step('merchant_busy_retrying', { attempt, error: String(e.message) });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  step('voucher_signed_and_redeemed', { claimId: purchase.claimId, redeemTx: purchase.transactionHash });
  out.quote = purchase.resource;
  out.redeemTx = purchase.transactionHash;
  out.claimId = purchase.claimId;

  await fetch(`${API}/public/participant/record-redemption`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tx_hash: purchase.transactionHash }),
  });
  const settled = await settle(API, token, channelId);
  out.payoutTx = settled.payout_tx;
  out.settlementTx = settled.settlement_tx;
  out.receiptUrl = settled.receipt_url ? new URL(settled.receipt_url, API).href : null;
  step('rlusd_settled_to_merchant', { payoutTx: settled.payout_tx, settlementTx: settled.settlement_tx, amountRlusd: settled.amount_rlusd, receipt: out.receiptUrl });

  // Use the paid quote to prepare (NOT send) the family remittance.
  const rate = Number(purchase.resource?.midMarketRate);
  if (rate > 0) {
    const principalUsd = Math.ceil((SEND_INR / rate) * 100) / 100;
    out.remittanceDraft = { sendInr: SEND_INR, rate, principalUsd, feeUsd: 0.99, totalUsd: +(principalUsd + 0.99).toFixed(2), status: 'AWAITING_HUMAN_APPROVAL' };
    step('remittance_prepared_awaiting_user_tap', out.remittanceDraft);
  }

  if (process.env.CLOSE_CHANNEL === '1') {
    const closed = await closeChannel(API, token, wallet, channelId);
    step('channel_closed', { tx: closed.tx_hash });
  }
  writeOut(out);
}

function writeOut(out) {
  mkdirSync('./out', { recursive: true });
  writeFileSync(`./out/run-${Date.now()}.json`, JSON.stringify(out, null, 2));
  writeFileSync('./out/latest.json', JSON.stringify(out, null, 2));
}

main().catch((e) => { audit(AUDIT, { name: 'error', error: String(e.message ?? e) }); console.error(e.message ?? e); process.exit(1); });
