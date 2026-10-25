import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, decide } from './policy.mjs';

const M = '0x' + 'ab'.repeat(32);
const base = { policy: { ...DEFAULT_POLICY, allowlist: [M] }, merchantId: M, priceRlusd: '0.25', redeemedRlusd: '0', purchasesThisRun: 0, cachedQuoteAgeSeconds: null, killSwitchOn: false };

test('allows an allowlisted, cheap purchase inside the cap', () => assert.equal(decide(base).allow, true));
test('kill switch wins over everything', () => assert.match(decide({ ...base, killSwitchOn: true }).reason, /KILL_SWITCH/));
test('refuses unknown merchant', () => assert.match(decide({ ...base, merchantId: '0x' + 'cd'.repeat(32) }).reason, /NOT_ALLOWLISTED/));
test('refuses price above ceiling', () => assert.match(decide({ ...base, priceRlusd: '0.75' }).reason, /PRICE_ABOVE_CEILING/));
test('refuses purchase that would exceed channel cap', () => assert.match(decide({ ...base, redeemedRlusd: '1.9' }).reason, /CHANNEL_CAP/));
test('allows purchase landing exactly on the cap', () => assert.equal(decide({ ...base, redeemedRlusd: '1.75' }).allow, true));
test('velocity limit', () => assert.match(decide({ ...base, purchasesThisRun: 3 }).reason, /VELOCITY/));
test('skips buying when cached quote is fresh', () => assert.match(decide({ ...base, cachedQuoteAgeSeconds: 30 }).reason, /NOT_NEEDED/));
test('refuses zero price', () => assert.match(decide({ ...base, priceRlusd: '0' }).reason, /INVALID_PRICE/));
