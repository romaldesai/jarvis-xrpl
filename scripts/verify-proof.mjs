#!/usr/bin/env node
// Re-verify every 0x…64 hash in the proof docs against XRPL EVM *testnet* (chain 1449000). Read-only, no keys.
//
//   node scripts/verify-proof.mjs [files...]     (default: docs/PROOF.md docs/AP4M-PROOF.md; RPC_URL overrides)
//
// Each hash is classified via eth_getTransactionReceipt:
//   success  - mined, status 1
//   reverted - mined, status 0 (expected only for the two intentional over-cap proofs below)
//   non-tx   - no receipt: an ID (merchant / channel / claim / digest), not a transaction
// Exit 1 if an unexpected revert appears, an expected revert is not reverted, or the RPC fails.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TESTNET_CHAIN_ID = 1449000n;
export const DEFAULT_RPC = 'https://rpc.testnet.xrplevm.org';
export const DEFAULT_FILES = ['docs/PROOF.md', 'docs/AP4M-PROOF.md'];
// Intentional on-chain rejections (public tx hashes).
export const EXPECTED_REVERTS = new Set([
  '0x20b146d6cf4a7e432844f99748c0643134e93ab8640bac9312ad485c3fef633b', // secret-scan:allow own-ledger OverCap
  '0xc1ba1b65d864c9aa2b6102c6281b1475cccfa9f334f77c83a466ed3a47f9e388', // secret-scan:allow AP4M VoucherExceedsChannelCap
]);

/** Unique lowercase 0x…64 hashes in a text, in first-seen order. Pure. */
export function extractHashes(text) {
  return [...new Set((text.match(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g) ?? []).map((h) => h.toLowerCase()))];
}

async function rpc(url, method, params, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) {
      if (i >= tries) throw new Error(`${method}: ${e.message}`);
      await new Promise((s) => setTimeout(s, 300 * i));
    }
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function verify({ rpcUrl = DEFAULT_RPC, files = DEFAULT_FILES, concurrency = 4, expectedReverts = EXPECTED_REVERTS } = {}) {
  const chain = BigInt(await rpc(rpcUrl, 'eth_chainId', []));
  if (chain !== TESTNET_CHAIN_ID) throw new Error(`refusing: chain ${chain} is not XRPL EVM testnet (1449000)`);
  const hashes = extractHashes(files.map((f) => readFileSync(f, 'utf8')).join('\n'));
  const rows = await pool(hashes, concurrency, async (hash) => {
    const rc = await rpc(rpcUrl, 'eth_getTransactionReceipt', [hash]);
    return { hash, kind: rc == null ? 'non-tx' : Number(rc.status) === 1 ? 'success' : 'reverted' };
  });
  const count = (k) => rows.filter((r) => r.kind === k).length;
  const problems = [
    ...rows.filter((r) => r.kind === 'reverted' && !expectedReverts.has(r.hash)).map((r) => `unexpected revert ${r.hash}`),
    ...[...expectedReverts].filter((h) => hashes.includes(h) && rows.find((r) => r.hash === h)?.kind !== 'reverted').map((h) => `expected revert not reverted ${h}`),
  ];
  return { chainId: chain.toString(), total: rows.length, success: count('success'), reverted: count('reverted'), nonTx: count('non-tx'), rows, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2);
  verify({ rpcUrl: process.env.RPC_URL || DEFAULT_RPC, files: files.length ? files : DEFAULT_FILES })
    .then((r) => {
      for (const row of r.rows) console.log(`${row.kind.padEnd(8)} ${row.hash}${EXPECTED_REVERTS.has(row.hash) ? '  (intentional over-cap proof)' : ''}`);
      console.log(`\nchain ${r.chainId}: ${r.total} hashes -> ${r.success} success, ${r.reverted} reverted, ${r.nonTx} non-tx (IDs)`);
      if (r.problems.length) { console.error(r.problems.join('\n')); process.exit(1); }
    })
    .catch((e) => { console.error(`verify-proof: ${e.message}`); process.exit(1); });
}
