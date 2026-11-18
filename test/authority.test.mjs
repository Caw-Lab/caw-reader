// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface, ZeroAddress, getAddress } from 'ethers';
import { readAuthority, makeAuthority, MAX_NETWORKS } from '../src/authority.mjs';
import { makeApi } from '../src/server.mjs';
import { openDb } from '../src/db.mjs';

const A = (n) => getAddress('0x' + n.toString(16).padStart(40, '0'));
const PROFILE = A(0x10), ACTIONS = A(0x20);
const EXP1 = A(0xe1), EP1 = A(0xa1), MINTER = A(0xb1), NM = A(0xc1), WALLET1 = A(0xd1), NETOWNER = A(0xd2);
const LEDGER = A(0xe2), EP2 = A(0xa2), EXP2 = A(0xe3), CAP = A(0xf1), WALLET2 = A(0xd3), WRITER = A(0xd4);
const ABI = new Interface([
  'function owner() view returns (address)', 'function endpoint() view returns (address)', 'function delegates(address) view returns (address)',
  'function minter() view returns (address)', 'function networkManager() view returns (address)', 'function pathwayExpander() view returns (address)',
  'function nextNetworkId() view returns (uint32)', 'function getNetworkOwner(uint32) view returns (address)',
  'function networkFeesLocked(uint32) view returns (bool)', 'function networkOwnershipLocked(uint32) view returns (bool)',
  'function cawProfile() view returns (address)', 'function capOracle() view returns (address)', 'function l2Writer() view returns (address)',
]);

// A fake chain: answers = { [address]: { [function name]: value or (args) => value } }
function fakeChain(block, answers, contracts) {
  const calls = [];
  return {
    calls,
    blockNumber: async () => block,
    call: async (to, data, tag) => {
      assert.equal(tag, block, 'every call is pinned to the block read first');
      const f = ABI.parseTransaction({ data });
      calls.push(to + '.' + f.name);
      let v = answers[to]?.[f.name];
      if (typeof v === 'function') v = v(...f.args);
      if (v === undefined) throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
      return ABI.encodeFunctionResult(f.name, [v]);
    },
    code: async (a) => (contracts.has(a) ? '0x6080' : '0x'),
  };
}

function world({ networks = 2, delegateRevert = false } = {}) {
  const l1 = fakeChain(1000, {
    [PROFILE]: { owner: EXP1, endpoint: EP1, minter: MINTER, networkManager: NM },
    [EP1]: { delegates: (a) => (a === PROFILE ? EXP1 : ZeroAddress) },
    [EXP1]: { owner: WALLET1 },
    [MINTER]: { pathwayExpander: EXP1 },
    [NM]: { nextNetworkId: networks + 1, getNetworkOwner: (id) => (id === 1n ? NETOWNER : WALLET1),
      networkFeesLocked: (id) => id === 2n, networkOwnershipLocked: () => false },
  }, new Set([PROFILE, EXP1, EP1, MINTER, NM]));
  const l2 = fakeChain(5000, {
    [ACTIONS]: { cawProfile: LEDGER, capOracle: CAP },
    [LEDGER]: { owner: ZeroAddress, endpoint: EP2 },
    [EP2]: delegateRevert ? {} : { delegates: (a) => (a === LEDGER ? EXP2 : ZeroAddress) },
    [EXP2]: { owner: WALLET2 },
    [CAP]: { l2Writer: WRITER },
  }, new Set([ACTIONS, LEDGER, EP2, EXP2, CAP]));
  return { l1, l2 };
}

const byKey = (r) => Object.fromEntries(r.contracts.map((c) => [c.key, c]));

test('authority: every contract is found from the two starting addresses and each holder is classified', async () => {
  const { l1, l2 } = world();
  const r = await readAuthority({ l1, l2, cawProfile: PROFILE, cawActions: ACTIONS });
  assert.equal(r.l1Block, 1000); assert.equal(r.l2Block, 5000);
  const c = byKey(r);
  assert.deepEqual(Object.keys(c), ['cawProfile', 'pathwayExpanderL1', 'networkManager', 'cawActions', 'cawProfileLedger', 'pathwayExpanderL2', 'capOracle']);
  assert.deepEqual(c.cawProfile.roles.map((x) => [x.role, x.holder.kind, x.holder.address]), [['owner', 'contract', EXP1], ['lzDelegate', 'contract', EXP1]]);
  assert.equal(c.pathwayExpanderL1.address, EXP1);
  assert.deepEqual(c.pathwayExpanderL1.roles[0].holder, { kind: 'eoa', address: WALLET1 });
  assert.deepEqual(c.pathwayExpanderL1.minterCheck, { address: EXP1, same: true });
  assert.equal(c.networkManager.networkCount, 2);
  assert.deepEqual(c.networkManager.networks.map((n) => [n.id, n.holder.address, n.feesLocked, n.ownershipLocked]), [[1, NETOWNER, false, false], [2, WALLET1, true, false]]);
  assert.deepEqual(c.cawActions.roles, []);
  assert.deepEqual(c.cawProfileLedger.roles.map((x) => [x.role, x.holder.kind]), [['owner', 'none'], ['lzDelegate', 'contract']]);
  assert.deepEqual(c.pathwayExpanderL2.roles[0].holder, { kind: 'eoa', address: WALLET2 });
  assert.deepEqual(c.capOracle.roles[0].holder, { kind: 'eoa', address: WRITER });
});

test('authority: a call that fails is shown as an error with a short code, not dropped', async () => {
  const { l1, l2 } = world({ delegateRevert: true });
  const c = byKey(await readAuthority({ l1, l2, cawProfile: PROFILE, cawActions: ACTIONS }));
  assert.deepEqual(c.cawProfileLedger.roles[1].holder, { kind: 'error', code: 'CALL_EXCEPTION' });
  assert.equal(c.pathwayExpanderL2, undefined, 'not reached when the delegate could not be read');
});

test('authority: the number of networks read is capped and the cut is reported', async () => {
  const { l1, l2 } = world({ networks: MAX_NETWORKS + 7 });
  const nm = byKey(await readAuthority({ l1, l2, cawProfile: PROFILE, cawActions: ACTIONS })).networkManager;
  assert.equal(nm.networkCount, MAX_NETWORKS + 7);
  assert.equal(nm.networks.length, MAX_NETWORKS);
  assert.equal(nm.truncated, true);
});

test('authority: one reading is shared until it expires, and the API serves it', async () => {
  const { l1, l2 } = world();
  const cfg = { l1RpcUrl: 'x', cawProfile: PROFILE, cawActions: ACTIONS };
  const get = makeAuthority(cfg, { chains: { l1, l2 }, ttlMs: 60_000 });
  const [a, b] = await Promise.all([get(), get()]);
  const n = l1.calls.length + l2.calls.length;
  assert.equal(a, b);
  await get();
  assert.equal(l1.calls.length + l2.calls.length, n, 'no new RPC calls while the reading is fresh');
  const route = makeApi(openDb(':memory:'), () => null, get);
  assert.equal((await route('/api/authority', new URLSearchParams())).l2Block, 5000);
  assert.equal(makeAuthority({ cawActions: ACTIONS }), null, 'needs l1RpcUrl and cawProfile');
  assert.deepEqual(await makeApi(openDb(':memory:'), () => null, null)('/api/authority', new URLSearchParams()), { error: 'not_configured', status: 404 });
});

test('authority: when the chain cannot be read and nothing is cached, the API answers 502 without RPC details', async () => {
  const bad = { blockNumber: async () => { throw new Error('connect ECONNREFUSED https://rpc.example/v2/SECRETKEY'); } };
  const get = makeAuthority({ l1RpcUrl: 'x', cawProfile: PROFILE, cawActions: ACTIONS }, { chains: { l1: bad, l2: bad } });
  const orig = console.error; console.error = () => {};
  try { assert.deepEqual(await get(), { error: 'rpc_failed', status: 502 }); } finally { console.error = orig; }
});
