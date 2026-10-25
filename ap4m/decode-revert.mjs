#!/usr/bin/env node
// Reproduce the decoded revert of the AP4M over-cap attempt.
// Replays the mined (status 0) transaction with eth_call at block - 1 and decodes the custom error.
// No dependencies, no keys: read-only JSON-RPC against XRPL EVM *testnet* only.
//
//   node decode-revert.mjs [txHash]        (RPC_URL overrides the default testnet RPC)
//
// The PaymentLedger ABI is not published by AP4M. The error NAME below is inferred from a selector match:
// keccak256("VoucherExceedsChannelCap(uint256,uint256)")[0:4] == 0xeeaa063e.
import { pathToFileURL } from 'node:url';

export const TESTNET_CHAIN_ID = 1449000n;
export const DEFAULT_RPC = 'https://rpc.testnet.xrplevm.org';
export const OVERCAP_TX = '0xc1ba1b65d864c9aa2b6102c6281b1475cccfa9f334f77c83a466ed3a47f9e388'; // secret-scan:allow (public tx hash)

// selector -> signature (inferred by selector match, not from a published ABI)
export const KNOWN_ERRORS = {
  '0xeeaa063e': { name: 'VoucherExceedsChannelCap', args: ['requested', 'cap'], inferred: true },
};

const fmt18 = (v) => {
  const s = v.toString().padStart(19, '0');
  const frac = s.slice(-18).replace(/0+$/, '');
  return `${BigInt(s.slice(0, -18))}${frac ? '.' + frac : '.0'}`;
};

/** Decode `0x<selector><uint256 words...>` revert data. Pure. */
export function decodeRevert(data) {
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]{8}([0-9a-fA-F]{64})*$/.test(data)) {
    return { selector: null, raw: data ?? null, error: 'not ABI-encoded custom-error data' };
  }
  const selector = data.slice(0, 10).toLowerCase();
  const words = (data.slice(10).match(/.{64}/g) ?? []).map((w) => BigInt('0x' + w));
  const known = KNOWN_ERRORS[selector];
  const out = { selector, words: words.map(String) };
  if (known && words.length === known.args.length) {
    out.name = known.name;
    out.signature = `${known.name}(${known.args.map(() => 'uint256').join(',')})`;
    out.nameInferredFromSelector = known.inferred;
    out.args = Object.fromEntries(known.args.map((k, i) => [k, { wei: words[i].toString(), rlusd: fmt18(words[i]) }]));
  }
  return out;
}

/** Pull revert data out of the various shapes JSON-RPC nodes use for eth_call errors. Pure. */
export function extractRevertData(err) {
  if (!err) return null;
  const d = err.data;
  if (typeof d === 'string' && d.startsWith('0x')) return d;
  if (d && typeof d === 'object') {
    if (typeof d.data === 'string') return d.data;
    if (typeof d.result === 'string') return d.result;
  }
  const m = typeof err.message === 'string' && err.message.match(/0x[0-9a-fA-F]{8,}/);
  return m ? m[0] : null;
}

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
  return r.json();
}

export async function run({ rpcUrl = DEFAULT_RPC, txHash = OVERCAP_TX } = {}) {
  const chain = await rpc(rpcUrl, 'eth_chainId', []);
  if (BigInt(chain.result) !== TESTNET_CHAIN_ID) throw new Error(`refusing: chain ${BigInt(chain.result)} is not XRPL EVM testnet (1449000)`);
  const { result: tx } = await rpc(rpcUrl, 'eth_getTransactionByHash', [txHash]);
  if (!tx) throw new Error(`tx ${txHash} not found`);
  const { result: rc } = await rpc(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
  const block = BigInt(tx.blockNumber);
  const call = { from: tx.from, to: tx.to, data: tx.input, gas: tx.gas, value: tx.value ?? '0x0' };
  const res = await rpc(rpcUrl, 'eth_call', [call, '0x' + (block - 1n).toString(16)]);
  const revertData = res.error ? extractRevertData(res.error) : null;
  return {
    txHash,
    status: rc ? Number(rc.status) : null,
    blockNumber: block.toString(),
    replayedAtBlock: (block - 1n).toString(),
    to: tx.to,
    callSucceeded: !res.error,
    revertData,
    decoded: revertData ? decodeRevert(revertData) : null,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run({ rpcUrl: process.env.RPC_URL || DEFAULT_RPC, txHash: process.argv[2] || OVERCAP_TX })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      const a = r.decoded?.args;
      if (a) console.log(`\n${r.decoded.name}: requested ${a.requested.rlusd} RLUSD > cap ${a.cap.rlusd} RLUSD (name inferred from selector ${r.decoded.selector}; AP4M does not publish the PaymentLedger ABI)`);
    })
    .catch((e) => {
      console.error(`decode-revert: ${e.message}`);
      process.exit(1);
    });
}
