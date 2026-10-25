// Offline tests for verify-proof.mjs (fake JSON-RPC server, temp files; no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractHashes, verify } from './verify-proof.mjs';

const h = (b) => '0x' + b.repeat(32);
const OK = h('a1'), BAD = h('b2'), ID = h('c3'), EXP = h('d4');

test('extractHashes: unique, lowercase, ignores 40-hex addresses and longer hex', () => {
  const t = `${OK} ${OK.toUpperCase().replace('0X', '0x')} 0x${'ee'.repeat(20)} 0x${'ff'.repeat(33)}`;
  assert.deepEqual(extractHashes(t), [OK]);
});

/**
 * Fake XRPL EVM RPC. `receipts` maps tx hash -> receipt; any hash in it also exists for eth_getTransactionByHash.
 * Like the real testnet RPC, eth_getTransactionReceipt for an unknown hash HANGS (never answers) unless hangUnknown=false.
 */
function fakeRpc(chainId, receipts, { hangUnknown = true, hangReceipts = new Set() } = {}) {
  const calls = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const { method, params } = JSON.parse(b);
      calls.push({ method, hash: params?.[0] });
      const reply = (result) => res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      if (method === 'eth_chainId') return reply('0x' + chainId.toString(16));
      if (method === 'eth_getTransactionByHash') return reply(receipts[params[0]] ? { hash: params[0] } : null);
      if (method === 'eth_getTransactionReceipt') {
        if (hangReceipts.has(params[0]) || (hangUnknown && !receipts[params[0]])) return; // hang
        return reply(receipts[params[0]] ?? null);
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'nope' } }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}
const stop = ({ srv }) => { srv.closeAllConnections(); srv.close(); };

function doc(text) {
  const f = join(mkdtempSync(join(tmpdir(), 'vp-')), 'p.md');
  writeFileSync(f, text);
  return f;
}

test('classifies success / expected revert / non-tx and passes', async () => {
  const f = await fakeRpc(1449000, { [OK]: { status: '0x1' }, [EXP]: { status: '0x0' } });
  try {
    const r = await verify({ rpcUrl: f.url, files: [doc(`${OK} ${EXP} ${ID}`)], expectedReverts: new Set([EXP]) });
    assert.deepEqual([r.success, r.reverted, r.nonTx], [1, 1, 1]);
    assert.deepEqual(r.problems, []);
  } finally { stop(f); }
});

test('non-tx ID: byHash null -> classified without ever calling the (hanging) receipt method', async () => {
  const f = await fakeRpc(1449000, {}, { hangUnknown: true });
  try {
    const t0 = Date.now();
    const r = await verify({ rpcUrl: f.url, files: [doc(ID)], timeoutMs: 5000 });
    assert.equal(r.nonTx, 1);
    assert.ok(Date.now() - t0 < 2000, 'should not wait on the hanging receipt call');
    assert.equal(f.calls.filter((c) => c.method === 'eth_getTransactionReceipt').length, 0);
  } finally { stop(f); }
});

test('a hung receipt call times out instead of stalling the run', async () => {
  const f = await fakeRpc(1449000, { [OK]: { status: '0x1' } }, { hangReceipts: new Set([OK]) });
  try {
    await assert.rejects(verify({ rpcUrl: f.url, files: [doc(OK)], timeoutMs: 150 }), /eth_getTransactionReceipt: request timed out after 150 ms/);
  } finally { stop(f); }
});

test('flags an unexpected revert', async () => {
  const f = await fakeRpc(1449000, { [BAD]: { status: '0x0' } });
  try {
    const r = await verify({ rpcUrl: f.url, files: [doc(BAD)], expectedReverts: new Set() });
    assert.match(r.problems[0], /unexpected revert/);
  } finally { stop(f); }
});

test('refuses mainnet (1440000)', async () => {
  const f = await fakeRpc(1440000, {});
  try {
    await assert.rejects(verify({ rpcUrl: f.url, files: [doc(OK)] }), /not XRPL EVM testnet/);
  } finally { stop(f); }
});
