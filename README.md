# caw-reader — a read-only CAW node (prototype)

caw-reader reads the chain from the oldest block forward, stores CAW posts, actions and usernames in a local database, and shows them in a browser. It never writes to the chain, never signs anything, and holds no keys.

## Public instance

https://caw-reader.com runs the `main` branch of this repository on Base Sepolia (chain id 84532) with the contract addresses in `config.example.json`. It has read the chain from the CawActions deployment block (45,547,482), so follow counts, profile fields and tips include every action since deployment. The server answers GET and HEAD only, and requests are rate-limited per IP address. The API listed below is reachable there as well, for example https://caw-reader.com/api/status.

## Sources and license

- This repository is licensed under MIT (`LICENSE`).
- The protocol sources are `solidity/contracts/` in GilgameshCaw/Caw (MIT) and the "CAW protocol spec memo (contract-based)" written only from those contracts ([`docs/spec-memo.md`](docs/spec-memo.md)). The upstream client code (UNLICENSED) was not used as a reference.
- The decoding of packed actions and of the post body compression format (smltxt) was carried over unchanged from the "read-only viewer prototype v0". The viewer's smltxt part was written only from the text of the spec memo.
- The statistics table used for decoding post bodies is not included. It is loaded at run time from commit `97cd13f3` of the upstream public repository and used only when its SHA-256 matches. If it cannot be loaded, post bodies are shown as compressed bytes (collection does not stop).

### How the smltxt decoder was written

- Upstream `smltxt/package.json` declares `"license": "UNLICENSED"` (checked on master `97cd13f3`, 2026-11-14). A proposal to make it MIT was submitted upstream as PR #364; it is not on master yet.
- The format was described in prose by ChatGPT Codex, which read upstream `smltxt/` at commit `97cd13f3` and was asked to include neither code nor the contents of the statistics table. The two requests and two reports are kept unedited in [`docs/smltxt-cleanroom-record-2026-10-24.txt`](docs/smltxt-cleanroom-record-2026-10-24.txt), with a SHA-256 for each part. A summary is in the "smltxt format" section of the spec memo. An English translation of the record is in [`docs/smltxt-cleanroom-record-2026-10-24.en.md`](docs/smltxt-cleanroom-record-2026-10-24.en.md); the Japanese original is the record itself.
- The decoder (`src/smltxt.mjs`) was written by Claude from those reports and from values observed in test posts only. Claude did not read the smltxt source code. The upstream statistics table was loaded programmatically for testing.
- This process does not prove that nothing was copied. Both `src/smltxt.mjs` and upstream `smltxt/src` are public, so anyone can compare them side by side. On 2026-10-24, Zinsanjp compared the viewer's decoder (the origin of `src/smltxt.mjs`) with upstream; the result is in the "Open issue: handling the statistics table" section of the spec memo. Thank you, Zinsanjp, for doing that comparison.

## Requirements

- Node.js 22.13 or later (for the built-in SQLite). The warning `ExperimentalWarning: SQLite is an experimental feature` at start-up is expected.

## Usage (Windows PowerShell)

```powershell
cd caw-reader
npm ci
copy config.example.json config.json
node bin\caw-reader.mjs find-start
```

On macOS or Linux, use `cp` instead of `copy` and `/` instead of `\`.

`find-start` binary-searches for the first block where the CawActions code exists. Put the number it prints into `startBlock` in `config.json`. If the RPC does not serve old state, this fails; in that case, look up the block of the CawActions creation transaction in an explorer and use that.

```powershell
node bin\caw-reader.mjs run
```

This keeps reading and serves the UI and API at `http://127.0.0.1:4380/`. Stop with Ctrl+C. Progress is stored in the database, so the next run continues where it stopped.

The UI can be shown in English or Japanese with the switch at the top right. The choice is kept in that browser only.

The UI has seven tabs: Posts, All actions, Stats, Search (accounts by name or number), Authority (who holds admin-only powers), Signatures (reads a pasted signing request) and Status (items for review). Each post has a "Receipt" button that unfolds, inside the post, where the post is on the chain and how to check it without any CAW node; the receipt also has its own link (`#/post/<senderId>/<cawonce>`). On wide screens the reading status is shown beside every tab; on narrow screens it is shown only on the Status tab. Owner addresses are returned by the API but are not shown in the UI.

Other commands:

| Command | What it does |
| --- | --- |
| `sync` | Read up to the current head and exit |
| `serve` | Serve the UI and API without reading |
| `status` | Show the database state |
| `diagnose` | Measure the RPC's `eth_getLogs` range limit, rate limit and access to old blocks, showing the raw responses |
| `archive-check` | Check CawActionsArchive submissions against the chain and this reader's data (read-only; see below) |

## RPCs that prune old history (measured 2026-10-24)

`https://sepolia.base.org` and `https://base-sepolia-rpc.publicnode.com` both prune history before block 46,500,000 and return `code 4444` "pruned history unavailable … earliest available 46500000".

- `sepolia.base.org`: `eth_getLogs` still answers for earlier blocks (up to 200 blocks per call). Block and transaction bodies are not returned.
- `base-sepolia-rpc.publicnode.com`: `eth_getLogs` does not answer either.

To read everything from the CawActions deployment (block 45,547,482), set `archiveRpcUrl` to an RPC that keeps full history. It is queried only when `rpcUrl` reports pruned history (logs are collected from `rpcUrl`; only the bodies come from the archive). Keep URLs that contain an API key only in `config.json`; `diagnose` masks the key in its output. If pruned history is hit and no `archiveRpcUrl` is set, reading stops and shows the reason (it does not skip silently).

## Why usernames are also read from L1 (measured 2026-10-25)

The username NFTs live in `CawProfile` on L1, where names are stored at `usernames[tokenId - 1]` (CawProfile.sol:77, 246). On L2, `CawProfileLedger.usernames(tokenId)` is filled only when an LZ message arrives from L1, and a plain `mint()` does not send an LZ message (comment at CawProfile.sol:256).

On 2026-10-25, 16 of tokenIds 1–62 had a name on L1 and an empty name on L2 (4 of them never appear in any L2 action). So when `l1RpcUrl` and `cawProfile` are set, L1 names are read up to `nextId`, only for the ids added since the previous run. L1 is read at the state `l1Confirmations` blocks behind the head. If L2 also has a name and it differs from L1, this is recorded as `name_mismatch` for review.

## OTHER actions, likes, tips and votes (2026-10-25)

Only the forms whose meaning was checked against real data in the spec memo section "OTHER actions and body conventions (observed in real data)" are interpreted (`src/other.mjs`).

- Likes: linked to a post through `(receiverId, receiverCawonce)` of LIKE/UNLIKE; the latest one per account is counted.
- Tips: OTHER `tip:a:b` (to a post) and `tip:` (to a profile), and CAWs that carry recipients and amounts (per recipient, to that CAW itself).
- `hide:caw:N` / `hide:recaw:a:b`: marks only the sender's own posts and RECAWs.
- `vote:N`: the latest vote per account is counted. This is a **provisional rule** and does not match node2 (see below).
- `p:{…}`: the latest value per key.
- Forms whose meaning has not been checked, such as `pi:`, `xpi:` and `sp-i:`, are not interpreted.

Comparison with the database of node2 (tencawffee.com, a CAW full node) on 2026-10-25: 62 of 63 tips matched, including recipient, amount and linked post. All 289 likes in node2 are also in caw-reader; caw-reader has 14 more (node2 has those same actions in its `Action` table). For votes, the way node2 keeps them could not be explained from chain data.

## What it does

1. Collects `ActionsProcessed` / `ActionsProcessedZk` / `ActionRejected` from `CawActions` and `UsernameMinted` / `OwnerSet` from `CawProfileLedger` with `eth_getLogs`, one block range at a time.
2. For each `ActionsProcessed`, searches the calldata of that transaction for the bytes whose keccak256 matches `batchHash`, and decodes them. This works for direct calls and for calls through another contract; only bytes whose hash matches are used.
3. Marks actions that were not executed, using `ActionRejected` on the safe path and `actionsExecutedBitmap` on the ZK path.
4. Reads usernames with `CawProfileLedger.usernames(tokenId)` (L2) and, if configured, `CawProfile.usernames(tokenId - 1)` (L1). The L2 name is shown first; the L1 name is used when L2 has none.

### Rules for not missing data

- A block range counts as read only when all of it has been written to the database. If a transaction body or block cannot be fetched, reading does not move forward; the next run starts from the same place (the idea behind upstream PR #60).
- Only blocks at least `confirmations` behind the head are read. If a log's block hash differs from the current block (a reorg in progress), that range is read again.
- If the RPC rejects a range as too wide, the range is halved automatically. On rate limiting (429), it waits and reads again.
- A batch with no matching bytes in its calldata is not dropped. It is kept as "unresolved", and the count is shown in the UI's side panel and in `/api/status`.

### Things it does not decide silently

- On the safe path, if one batch contains two or more different actions with the same `(senderId, cawonce)` and one of them was rejected, the logs cannot tell which one, so it is marked "ambiguous".
- If an already accepted `(senderId, cawonce)` appears as accepted again, the later one is recorded as "duplicate" (this should not happen on the contract).
- The meaning of `receiverCawonce`, which tells which post a like or RECAW is for, cannot be determined from the contracts. Likes and RECAWs are linked to posts by the mapping checked against real data (spec memo section "receiverCawonce"), and the UI shows like and RECAW counts under each post.

## API (GET only, served on 127.0.0.1 only)

| Path | Contents |
| --- | --- |
| `/api/status` | Read position, counts, numbers of unresolved and review items, statistics table state, and the chain and contracts the database was built from |
| `/api/posts?limit=50&before=<seq>` | Accepted posts (newest first) |
| `/api/posts/<senderId>/<cawonce>` | One post with its receipt: block, transaction, log index, signature path, validator, position in the batch, batch hash, body size, and the likes, RECAWs, tips and votes pointing at it |
| `/api/actions?limit=50&before=<seq>` | All actions (with status) |
| `/api/users?q=<text>` | Accounts whose name starts with the text (`@` optional), or the account with that number (`13` or `#13`); up to 20 |
| `/api/users/<tokenId>` | Name, owner, follow counts, number of posts, profile fields |
| `/api/users/<tokenId>/posts` | Posts by that name |
| `/api/stats?days=30` | Per UTC day over the last 1 to 365 days: posts, accepted and not accepted actions, active accounts, tips; and counts by action type. The result is reused for one minute |
| `/api/anomalies` | Items recorded for review |
| `/api/authority` | Who holds each admin-only power in the CAW contracts, read by the server from the L1 and L2 RPCs at one pinned block per chain (see below). One reading is shared for up to 10 minutes |

## Authority and Signatures tabs (2026-11-18)

Both are written from `solidity/contracts` in GilgameshCaw/Caw (MIT, master `97cd13f`) only. Each item in the UI shows the file and lines it comes from, and neither tab judges what it shows.

**Authority** (`src/authority.mjs`, `/api/authority`). The server starts from `cawProfile` (L1) and `cawActions` (L2) in the config and finds every other contract by following values on the chain: `CawProfile.owner()` (PathwayExpander on L1), `CawProfile.networkManager()`, `CawActions.cawProfile()` (CawProfileLedger), `delegates(CawProfileLedger)` on its LayerZero endpoint (PathwayExpander on L2) and `CawActions.capOracle()`. For each power it shows the holder and whether that address has code (`eth_getCode`): a contract, a plain wallet, or the zero address. Network owners are read for at most 50 networks, and the result says when it was cut. Only `eth_blockNumber`, `eth_call` and `eth_getCode` are used, so the browser never calls an RPC, and the RPC sees at most one reading per 10 minutes however many people open the tab. Errors are reduced to a short code in the response, because RPC error messages can contain the RPC URL. CawActionsArchive and CawChallengeRelay are not read yet: no way to reach them from the two starting addresses has been found.

**Signatures** (`public/sign.js`). Paste `eth_signTypedData_v4` JSON or `personal_sign` text. It recognises `ActionData`, `ActionBatch`, `SessionDelegation`, `TokenSessionDelegation`, `RevokeSession` and the "Enable Quick Sign" message, checks the domain name and version and that the type definition matches the contract's exactly, compares `verifyingContract` with the contracts this reader reads (`/api/status`), and says in plain words what signing would do. An `OTHER` action whose body is the 71-byte `qs:` form is shown as registering a Quick Sign key, with its key, expiry and cap (`CawActions.sol:1452-1483`). What is pasted is read only in the browser and is not sent anywhere, including this server. Bodies compressed with smltxt are not decompressed in this tab.

The Quick Sign text rules were compared with the contract itself: `SessionMessageParser.sol` was compiled (solc 0.8.24) and run in an EVM on 24 messages, and the tab gave the same result for all 24. Those cases are kept in `test/sign.test.mjs`. Two things the comparison showed about the contract's parser: it does not check the first two characters of the key line (normally `0x`), and it does not check the text after the time on the expiry line (normally `UTC`).

## archive-check: checking CawActionsArchive submissions

```powershell
node bin/caw-reader.mjs archive-check [--submission N] [--config config.json]
```

Read-only. For each submission of CawActionsArchive (all of them, or the one given) it takes the arguments of the `submitReplication` call and checks:

1. `dataCommitment` = `keccak256(packedHash, rHash, entryHash)` equals the stored value.
2. The shape: `(end - start + 1) x 32` actions, as many `r` values, no trailing bytes, and the root in the call equals the stored `merkleRoot`.
3. The hash chain folded over the actions (as `slashIncoherentRoot` does) gives a Merkle root equal to the stored `merkleRoot`.
4. Every checkpoint hash equals `networkHashAtCheckpoint(networkId, cp)` on the chain CawActions runs on (`rpcUrl`, `cawActions`), and `entryHash` equals the hash of the checkpoint before the first one (the zero hash for checkpoint 1).
5. Each action in the submission equals the accepted action this reader stored for the same `(sender_id, cawonce)`. This needs the reader's database; without one the check is skipped. Actions the reader has not read yet are counted as "not read yet" and are not a failure. Rows the reader marked `ambiguous` are listed on their own, with the candidate the archive equals, and are not counted as differences.

If nothing could be compared with the reader's database (no database, or nothing read yet), the line says "NOT CHECKED" and the summary says so: such a submission has passed only the checks against the chain. Rate limits and timeouts of the RPCs are retried (up to 4 tries); URLs in error messages are cut to their origin, so a key in an RPC URL is not printed.

The status (PENDING / FINALIZED / SLASHED) is printed next to every submission: a PENDING submission passing the checks is correct, but it is not final until someone calls `finalizeSubmission`.

Exit code: 0 all checks passed, 1 some check failed, 2 a submission could not be read.

It needs `cawArchive` in the config (see `config.example.json`). **`cawArchive` is not `archiveRpcUrl`**: `archiveRpcUrl` is a full-history RPC of the main chain, used only when `rpcUrl` has pruned old state; `cawArchive` is the chain and address of CawActionsArchive.

What it does not compare: the other direction. An action that this reader stored as accepted but that is missing from the archive is not looked for in the database; it shows up only as a checkpoint hash that differs from the source chain. Actions that came through `CawActionsERC1271` have not been compared against a synced database. The transaction of a submission must be a direct `submitReplication` call.

What it cannot show: actions that were not applied (rejected, or skipped by a ZK batch) are not in the archive; the actions after the last submitted checkpoint are not in any submission yet; and times and Base transactions are not in the archive. The checkpoint hashes are read from the source chain, so the comparison with it can only be done while that chain answers.

The transaction of a submission is found from its time (`finalizedAt` minus the challenge period) and a narrow `eth_getLogs` range around the estimated block, because public RPCs refuse wide ranges. A full run reads a few dozen blocks' logs and one `eth_call` per checkpoint.

## Not done yet

- The `CawActionsERC1271` address is not in the example config (set `cawActionsErc1271` after checking it against the deployment record, and it will be read).
- Only one RPC is trusted. Results are not cross-checked across multiple RPCs.
- Detection of reorgs deeper than `confirmations`.
- Interpretation of OTHER forms whose meaning has not been checked (`pi:`, `xpi:`, `sp-i:` and others).
- Images, DMs and notifications.

## Tests

```powershell
npm test
```

The 12 smltxt test vectors need the statistics table. Pass the path of upstream `smltxt/src/tableData.ts` to run them; otherwise they are skipped.

```powershell
$env:CAW_TABLE_FILE = "C:\path\to\Caw\smltxt\src\tableData.ts"
npm test
```

GitHub Actions (`.github/workflows/test.yml`) also runs the tests on Node 22 and 24 for every push and pull request. It downloads the table from the pinned upstream commit, and the run fails if any test fails or is skipped.
