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

function fakeRpc(chainId, receipts) {
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const { method, params } = JSON.parse(b);
      const reply = (result) => res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      if (method === 'eth_chainId') return reply('0x' + chainId.toString(16));
      if (method === 'eth_getTransactionReceipt') return reply(receipts[params[0]] ?? null);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'nope' } }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

function doc(text) {
  const f = join(mkdtempSync(join(tmpdir(), 'vp-')), 'p.md');
  writeFileSync(f, text);
  return f;
}

test('classifies success / expected revert / non-tx and passes', async () => {
  const srv = await fakeRpc(1449000, { [OK]: { status: '0x1' }, [EXP]: { status: '0x0' } });
  try {
    const r = await verify({ rpcUrl: `http://127.0.0.1:${srv.address().port}`, files: [doc(`${OK} ${EXP} ${ID}`)], expectedReverts: new Set([EXP]) });
    assert.deepEqual([r.success, r.reverted, r.nonTx], [1, 1, 1]);
    assert.deepEqual(r.problems, []);
  } finally { srv.close(); }
});

test('flags an unexpected revert', async () => {
  const srv = await fakeRpc(1449000, { [BAD]: { status: '0x0' } });
  try {
    const r = await verify({ rpcUrl: `http://127.0.0.1:${srv.address().port}`, files: [doc(BAD)], expectedReverts: new Set() });
    assert.match(r.problems[0], /unexpected revert/);
  } finally { srv.close(); }
});

test('refuses mainnet (1440000)', async () => {
  const srv = await fakeRpc(1440000, {});
  try {
    await assert.rejects(verify({ rpcUrl: `http://127.0.0.1:${srv.address().port}`, files: [doc(OK)] }), /not XRPL EVM testnet/);
  } finally { srv.close(); }
});
