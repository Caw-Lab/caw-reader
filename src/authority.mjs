// SPDX-License-Identifier: MIT
//
// Who holds each admin-only power in the CAW contracts, read from the chain.
// Only eth_blockNumber, eth_call and eth_getCode are used, each chain at one pinned block.
// Starting from CawProfile (L1) and CawActions (L2), every other contract is found by
// following values on the chain. What each power allows is described in the UI with
// references to GilgameshCaw/Caw solidity/contracts (MIT).

import { Interface, JsonRpcProvider, ZeroAddress } from 'ethers';

const ABI = new Interface([
  'function owner() view returns (address)',
  'function endpoint() view returns (address)',
  'function delegates(address) view returns (address)',
  'function minter() view returns (address)',
  'function networkManager() view returns (address)',
  'function pathwayExpander() view returns (address)',
  'function nextNetworkId() view returns (uint32)',
  'function getNetworkOwner(uint32) view returns (address)',
  'function networkFeesLocked(uint32) view returns (bool)',
  'function networkOwnershipLocked(uint32) view returns (bool)',
  'function cawProfile() view returns (address)',
  'function capOracle() view returns (address)',
  'function l2Writer() view returns (address)',
]);

// Networks are read one by one, so their number is capped; the result says when it was cut
export const MAX_NETWORKS = 50;
const CALL_TIMEOUT_MS = 20000;

function withTimeout(p, what) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error('timeout: ' + what), { code: 'TIMEOUT' })), CALL_TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

// A chain as used here: three read-only calls
export function rpcChain(url, chainId) {
  const p = new JsonRpcProvider(url, chainId, { staticNetwork: true, batchMaxCount: 1 });
  return {
    blockNumber: () => withTimeout(p.getBlockNumber(), 'eth_blockNumber'),
    call: (to, data, blockTag) => withTimeout(p.call({ to, data, blockTag }), 'eth_call'),
    code: (address, blockTag) => withTimeout(p.getCode(address, blockTag), 'eth_getCode'),
  };
}

// The error is reduced to a short code: messages from an RPC can carry its URL, which may hold an API key
const errCode = (e) => (typeof e?.code === 'string' && /^[A-Z_]{3,40}$/.test(e.code) ? e.code : 'ERROR');

async function readAt(chain, block) {
  let requests = 0;
  const call = async (to, fn, args = []) => {
    requests++;
    const out = await chain.call(to, ABI.encodeFunctionData(fn, args), block);
    return ABI.decodeFunctionResult(fn, out)[0];
  };
  const tryCall = async (to, fn, args) => { try { return { v: await call(to, fn, args) }; } catch (e) { return { e: errCode(e) }; } };
  const holder = async (r) => {
    if (r.e) return { kind: 'error', code: r.e };
    if (r.v === ZeroAddress) return { kind: 'none', address: ZeroAddress };
    requests++;
    try {
      const code = await chain.code(r.v, block);
      return { kind: code && code !== '0x' ? 'contract' : 'eoa', address: r.v };
    } catch (e) { return { kind: 'error', code: errCode(e), address: r.v }; }
  };
  return { tryCall, holder, count: () => requests };
}

const usable = (r) => !r.e && r.v !== ZeroAddress;

export async function readAuthority({ l1, l2, cawProfile, cawActions }) {
  const [b1, b2] = await Promise.all([l1.blockNumber(), l2.blockNumber()]);
  const L1 = await readAt(l1, b1);
  const L2 = await readAt(l2, b2);
  const contracts = [];

  // ---- L1: CawProfile
  const pOwner = await L1.tryCall(cawProfile, 'owner');
  const pEndpoint = await L1.tryCall(cawProfile, 'endpoint');
  const pDelegate = usable(pEndpoint) ? await L1.tryCall(pEndpoint.v, 'delegates', [cawProfile]) : pEndpoint;
  const pMinter = await L1.tryCall(cawProfile, 'minter');
  const pNM = await L1.tryCall(cawProfile, 'networkManager');
  contracts.push({ chain: 'l1', key: 'cawProfile', address: cawProfile, foundVia: 'seed', roles: [
    { role: 'owner', holder: await L1.holder(pOwner) },
    { role: 'lzDelegate', holder: await L1.holder(pDelegate) },
  ] });

  // ---- L1: PathwayExpander (the owner of CawProfile)
  if (usable(pOwner)) {
    const eOwner = await L1.tryCall(pOwner.v, 'owner');
    const fromMinter = usable(pMinter) ? await L1.tryCall(pMinter.v, 'pathwayExpander') : pMinter;
    contracts.push({ chain: 'l1', key: 'pathwayExpanderL1', address: pOwner.v, foundVia: 'cawProfile.owner', roles: [
      { role: 'owner', holder: await L1.holder(eOwner) },
    ], minterCheck: fromMinter.e ? null : { address: fromMinter.v, same: fromMinter.v === pOwner.v } });
  }

  // ---- L1: CawNetworkManager
  if (usable(pNM)) {
    const next = await L1.tryCall(pNM.v, 'nextNetworkId');
    const networks = [];
    let count = null;
    if (!next.e) {
      count = Math.max(0, Number(next.v) - 1);
      for (let id = 1; id <= Math.min(count, MAX_NETWORKS); id++) {
        const o = await L1.tryCall(pNM.v, 'getNetworkOwner', [id]);
        const f = await L1.tryCall(pNM.v, 'networkFeesLocked', [id]);
        const s = await L1.tryCall(pNM.v, 'networkOwnershipLocked', [id]);
        networks.push({ id, holder: await L1.holder(o), feesLocked: f.e ? null : f.v, ownershipLocked: s.e ? null : s.v });
      }
    }
    contracts.push({ chain: 'l1', key: 'networkManager', address: pNM.v, foundVia: 'cawProfile.networkManager', roles: [],
      networkCount: count, networks, truncated: count != null && count > MAX_NETWORKS, error: next.e ?? null });
  }

  // ---- L2: CawActions (no owner; its references are immutable)
  const aLedger = await L2.tryCall(cawActions, 'cawProfile');
  const aCap = await L2.tryCall(cawActions, 'capOracle');
  contracts.push({ chain: 'l2', key: 'cawActions', address: cawActions, foundVia: 'seed', roles: [] });

  // ---- L2: CawProfileLedger
  if (usable(aLedger)) {
    const lOwner = await L2.tryCall(aLedger.v, 'owner');
    const lEndpoint = await L2.tryCall(aLedger.v, 'endpoint');
    const lDelegate = usable(lEndpoint) ? await L2.tryCall(lEndpoint.v, 'delegates', [aLedger.v]) : lEndpoint;
    const dHolder = await L2.holder(lDelegate);
    contracts.push({ chain: 'l2', key: 'cawProfileLedger', address: aLedger.v, foundVia: 'cawActions.cawProfile', roles: [
      { role: 'owner', holder: await L2.holder(lOwner) },
      { role: 'lzDelegate', holder: dHolder },
    ] });
    // ---- L2: PathwayExpander (the LayerZero delegate of the ledger, when it is a contract with an owner)
    if (dHolder.kind === 'contract') {
      const eOwner = await L2.tryCall(lDelegate.v, 'owner');
      if (!eOwner.e) contracts.push({ chain: 'l2', key: 'pathwayExpanderL2', address: lDelegate.v, foundVia: 'ledger.lzDelegate', roles: [
        { role: 'owner', holder: await L2.holder(eOwner) },
      ] });
    }
  }

  // ---- L2: CawCapOracle
  if (usable(aCap)) {
    const w = await L2.tryCall(aCap.v, 'l2Writer');
    contracts.push({ chain: 'l2', key: 'capOracle', address: aCap.v, foundVia: 'cawActions.capOracle', roles: [
      { role: 'l2Writer', holder: await L2.holder(w) },
    ] });
  }

  return { l1Block: b1, l2Block: b2, readAt: Date.now(), requests: L1.count() + L2.count() + 2, contracts };
}

// One reading is shared by every visitor for `ttlMs`; at most one reading runs at a time
export function makeAuthority(cfg, { chains, ttlMs = 10 * 60_000 } = {}) {
  if (!cfg.l1RpcUrl || !cfg.cawProfile) return null;
  const { l1, l2 } = chains ?? { l1: rpcChain(cfg.l1RpcUrl, cfg.l1ChainId), l2: rpcChain(cfg.rpcUrl, cfg.chainId) };
  let cached = null; let running = null;
  return async function get() {
    if (cached && Date.now() - cached.readAt < ttlMs) return cached;
    if (!running) {
      running = readAuthority({ l1, l2, cawProfile: cfg.cawProfile, cawActions: cfg.cawActions })
        .then((v) => { cached = v; return v; })
        .finally(() => { running = null; });
    }
    try { return await running; } catch (e) {
      console.error('authority: ' + (e?.message ?? e));
      if (cached) return { ...cached, stale: true };
      return { error: 'rpc_failed', status: 502 };
    }
  };
}
