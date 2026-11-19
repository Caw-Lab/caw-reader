// SPDX-License-Identifier: MIT
//
// Loads the config file. Addresses are read only from here (spec memo section "Rules").

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getAddress } from 'ethers';

const DEFAULTS = {
  rpcUrl: 'https://sepolia.base.org',
  archiveRpcUrl: null,
  chainId: 84532,
  cawActions: null,
  cawActionsErc1271: null,
  ledger: null,
  cawArchive: null,
  l1RpcUrl: null,
  l1ChainId: 11155111,
  cawProfile: null,
  l1Confirmations: 12,
  startBlock: null,
  confirmations: 20,
  logWindow: 2000,
  pollSeconds: 15,
  db: 'caw-reader.sqlite',
  tableUrl: null,
  tableFile: null,
  tableSha256: null,
  listen: { host: '127.0.0.1', port: 4380 },
};

function addr(v, name, required) {
  if (v == null || v === '') {
    if (required) throw new Error('Config ' + name + ' is missing');
    return null;
  }
  try { return getAddress(String(v).trim()); } catch { throw new Error('Config ' + name + ' is not an address'); }
}

function int(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Config ' + name + ' must be an integer from ' + min + ' to ' + max);
  return n;
}

export async function loadConfig(path) {
  const file = resolve(path);
  let raw;
  // Strip the BOM that editors such as Notepad add at the start
  try { raw = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error('Cannot read the config file (' + file + '): ' + e.message); }
  const c = { ...DEFAULTS, ...raw, listen: { ...DEFAULTS.listen, ...(raw.listen || {}) } };
  const base = dirname(file);

  const cfg = {
    rpcUrl: String(c.rpcUrl),
    archiveRpcUrl: c.archiveRpcUrl ? String(c.archiveRpcUrl) : null,
    chainId: int(c.chainId, 'chainId', 1, 2 ** 40),
    cawActions: addr(c.cawActions, 'cawActions', true),
    cawActionsErc1271: addr(c.cawActionsErc1271, 'cawActionsErc1271', false),
    ledger: addr(c.ledger, 'ledger', true),
    // CawActionsArchive (the replication chain). Not the same as archiveRpcUrl, which is a full-history RPC of the main chain
    cawArchive: c.cawArchive ? {
      rpcUrl: String(c.cawArchive.rpcUrl ?? ''),
      chainId: int(c.cawArchive.chainId ?? 421614, 'cawArchive.chainId', 1, 2 ** 40),
      address: addr(c.cawArchive.address, 'cawArchive.address', true),
    } : null,
    l1RpcUrl: c.l1RpcUrl ? String(c.l1RpcUrl) : null,
    l1ChainId: int(c.l1ChainId, 'l1ChainId', 1, 2 ** 40),
    cawProfile: addr(c.cawProfile, 'cawProfile', false),
    l1Confirmations: int(c.l1Confirmations, 'l1Confirmations', 0, 10000),
    startBlock: c.startBlock == null || c.startBlock === '' ? null : int(c.startBlock, 'startBlock', 0, 2 ** 40),
    confirmations: int(c.confirmations, 'confirmations', 0, 10000),
    logWindow: int(c.logWindow, 'logWindow', 1, 1000000),
    pollSeconds: int(c.pollSeconds, 'pollSeconds', 1, 3600),
    db: resolve(base, String(c.db)),
    tableUrl: c.tableUrl ? String(c.tableUrl) : null,
    tableFile: c.tableFile ? resolve(base, String(c.tableFile)) : null,
    tableSha256: c.tableSha256 ? String(c.tableSha256).toLowerCase() : null,
    listen: { host: String(c.listen.host), port: int(c.listen.port, 'listen.port', 1, 65535) },
  };
  if (!/^https?:\/\//.test(cfg.rpcUrl)) throw new Error('Config rpcUrl must start with http(s)://');
  if (cfg.archiveRpcUrl && !/^https?:\/\//.test(cfg.archiveRpcUrl)) throw new Error('Config archiveRpcUrl must start with http(s)://');
  if (cfg.l1RpcUrl && !/^https?:\/\//.test(cfg.l1RpcUrl)) throw new Error('Config l1RpcUrl must start with http(s)://');
  if (cfg.cawArchive && !/^https?:\/\//.test(cfg.cawArchive.rpcUrl)) throw new Error('Config cawArchive.rpcUrl must start with http(s)://');
  if (!!cfg.l1RpcUrl !== !!cfg.cawProfile) throw new Error('Reading names from L1 needs both l1RpcUrl and cawProfile');
  if ((cfg.tableUrl || cfg.tableFile) && !/^[0-9a-f]{64}$/.test(cfg.tableSha256 || '')) {
    throw new Error('Using the statistics table needs tableSha256 (64 hex digits)');
  }
  return cfg;
}

// A mark of which chain and contracts the DB belongs to. If it differs from the config, stop without using the DB.
export function fingerprint(cfg) {
  return JSON.stringify({
    chainId: cfg.chainId,
    cawActions: cfg.cawActions,
    cawActionsErc1271: cfg.cawActionsErc1271,
    ledger: cfg.ledger,
  });
}
