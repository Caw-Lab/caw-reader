# caw-reader — a read-only CAW node (prototype)

caw-reader reads the chain from the oldest block forward, stores CAW posts, actions and usernames in a local database, and shows them in a browser. It never writes to the chain, never signs anything, and holds no keys.

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

The UI has five tabs: Posts, All actions, Stats, Search (accounts by name or number) and Status (items for review). Each post has a "Receipt" button that unfolds, inside the post, where the post is on the chain and how to check it without any CAW node; the receipt also has its own link (`#/post/<senderId>/<cawonce>`). On wide screens the reading status is shown beside every tab; on narrow screens it is shown only on the Status tab. Owner addresses are returned by the API but are not shown in the UI.

Other commands:

| Command | What it does |
| --- | --- |
| `sync` | Read up to the current head and exit |
| `serve` | Serve the UI and API without reading |
| `status` | Show the database state |
| `diagnose` | Measure the RPC's `eth_getLogs` range limit, rate limit and access to old blocks, showing the raw responses |

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
