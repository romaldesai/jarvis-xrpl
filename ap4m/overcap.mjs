// Over-cap proof: the agent tries to redeem a Voucher for MORE than the channel cap.
// 1) Our policy refuses it off-chain. 2) We still force the transaction on-chain (fixed gas limit, so ethers
//    cannot skip it) to show PaymentLedger itself reverts it: "settled <= redeemed <= cap".
import { mkdirSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';
import sdk from './ap4m-hackathon-sdk.cjs';
import { DEFAULT_POLICY, decide, audit, loadEnv } from './policy.mjs';

loadEnv();
const { signIn, listChannels, getChannelState, signVoucher } = sdk;
const API = process.env.AP4M_API_URL || 'https://hackathon.ap4m.build';
const KEY = process.env.AGENT_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;

const config = await (await fetch(`${API}/public/config`)).json();
const provider = new ethers.JsonRpcProvider(config.network.rpcUrl);
const wallet = new ethers.Wallet(KEY, provider);
const ledger = config.contracts?.paymentLedger || config.paymentLedger;
const { token } = await signIn(API, process.env.TEAM_NAME || 'RomsCoin', wallet);
const channel = (await listChannels(API, token)).find((c) => c.channel_status === 'open' && c.merchant_id?.toLowerCase() === MERCHANT_ID.toLowerCase());
if (!channel) throw new Error('no open channel; run agent.mjs first');
const st = await getChannelState(provider, ledger, channel.channel_id);
const attempt = st.cap + ethers.parseUnits('1', 18); // 1 RLUSD beyond the cap
const verdict = decide({
  policy: { ...DEFAULT_POLICY, allowlist: [MERCHANT_ID], maxPriceRlusd: '1000', channelCapRlusd: ethers.formatUnits(st.cap, 18) },
  merchantId: MERCHANT_ID, priceRlusd: ethers.formatUnits(attempt - st.redeemed, 18), redeemedRlusd: ethers.formatUnits(st.redeemed, 18),
  purchasesThisRun: 0, cachedQuoteAgeSeconds: null, killSwitchOn: false,
});
console.log('policy:', verdict);
audit('./out/audit.jsonl', { name: 'overcap_policy_decision', ...verdict });

const sig = await signVoucher(wallet, ledger, channel.channel_id, attempt);
const abi = ['function redeemVoucher((bytes32 channelId,uint256 cumulativeAmount) voucher, bytes signature)'];
const c = new ethers.Contract(ledger, abi, wallet);
let reason = null;
try { await c.redeemVoucher.staticCall({ channelId: channel.channel_id, cumulativeAmount: attempt }, sig); } catch (e) { reason = e.shortMessage || e.reason || e.message; }
const tx = await c.redeemVoucher({ channelId: channel.channel_id, cumulativeAmount: attempt }, sig, { gasLimit: 300000 });
const rc = await provider.waitForTransaction(tx.hash);
const result = { channelId: channel.channel_id, capRlusd: ethers.formatUnits(st.cap, 18), attemptedCumulativeRlusd: ethers.formatUnits(attempt, 18), txHash: tx.hash, status: rc.status, revertReason: reason };
console.log(result);
audit('./out/audit.jsonl', { name: 'overcap_onchain_attempt', ...result });
mkdirSync('./out', { recursive: true });
writeFileSync('./out/overcap.json', JSON.stringify(result, null, 2));
