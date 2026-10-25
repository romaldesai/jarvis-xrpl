// Offline tests for decode-revert.mjs: pure decoding + a fake JSON-RPC server (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { decodeRevert, extractRevertData, run, KNOWN_ERRORS } from './decode-revert.mjs';

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const DATA = '0xeeaa063e' + word(3n * 10n ** 18n) + word(2n * 10n ** 18n);

test('decodes VoucherExceedsChannelCap(3 RLUSD, 2 RLUSD)', () => {
  const d = decodeRevert(DATA);
  assert.equal(d.selector, '0xeeaa063e');
  assert.equal(d.name, 'VoucherExceedsChannelCap');
  assert.equal(d.nameInferredFromSelector, true);
  assert.equal(d.args.requested.wei, '3000000000000000000');
  assert.equal(d.args.cap.wei, '2000000000000000000');
  assert.equal(d.args.requested.rlusd, '3.0');
  assert.equal(d.args.cap.rlusd, '2.0');
});

test('selector really is keccak256("VoucherExceedsChannelCap(uint256,uint256)")[0:4]', (t) => {
  let ethers;
  try { ethers = createRequire(import.meta.url)('ethers'); } catch { return t.skip('ethers not installed'); }
  for (const [sel, e] of Object.entries(KNOWN_ERRORS)) {
    assert.equal(ethers.id(`${e.name}(${e.args.map(() => 'uint256').join(',')})`).slice(0, 10), sel);
  }
});

test('unknown selector / garbage is reported, not guessed', () => {
  assert.equal(decodeRevert('0x12345678' + word(1)).name, undefined);
  assert.equal(decodeRevert('nope').selector, null);
});

test('extracts revert data from common node error shapes', () => {
  assert.equal(extractRevertData({ data: DATA }), DATA);
  assert.equal(extractRevertData({ data: { data: DATA } }), DATA);
  assert.equal(extractRevertData({ message: `execution reverted: ${DATA}` }), DATA);
  assert.equal(extractRevertData(null), null);
});

function fakeRpc(chainId, onCall) {
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const { method, params } = JSON.parse(b);
      const reply = (o) => res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, ...o }));
      if (method === 'eth_chainId') return reply({ result: '0x' + chainId.toString(16) });
      if (method === 'eth_getTransactionByHash') return reply({ result: { blockNumber: '0x64', from: '0x' + '11'.repeat(20), to: '0x' + '22'.repeat(20), input: '0xabcdef', gas: '0x493e0', value: '0x0' } });
      if (method === 'eth_getTransactionReceipt') return reply({ result: { status: '0x0' } });
      if (method === 'eth_call') { onCall?.(params); return reply({ error: { code: 3, message: 'execution reverted', data: DATA } }); }
      reply({ error: { code: -32601, message: 'nope' } });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('run() replays at block-1 and decodes (fake testnet RPC)', async () => {
  let callParams;
  const srv = await fakeRpc(1449000, (p) => (callParams = p));
  try {
    const r = await run({ rpcUrl: `http://127.0.0.1:${srv.address().port}`, txHash: '0x' + 'ab'.repeat(32) });
    assert.equal(r.status, 0);
    assert.equal(callParams[1], '0x63'); // block 100 - 1
    assert.equal(r.decoded.name, 'VoucherExceedsChannelCap');
  } finally { srv.close(); }
});

test('run() refuses a non-testnet chain (e.g. mainnet 1440000)', async () => {
  const srv = await fakeRpc(1440000);
  try {
    await assert.rejects(run({ rpcUrl: `http://127.0.0.1:${srv.address().port}` }), /not XRPL EVM testnet/);
  } finally { srv.close(); }
});
