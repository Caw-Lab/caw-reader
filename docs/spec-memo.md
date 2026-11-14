# CAW protocol spec memo (contract-based)

Oct 24, 2026 · @ten

## Principle: keep both the upstream and the community paths open

This document is a preparation for keeping CAW development from stopping. It does not aim at a split from upstream. If Gilgamesh comes back, development returns to upstream. Even in the worst case where he does not, the community should be in a position to keep CAW going.

### Background

- The latest commit on upstream (GilgameshCaw/Caw) master is from 2026-09-20 (`97cd13f3`). No activity has been observable since then (as of 2026-10-24).
- There are more than 200 open PRs.
- The upstream contracts are MIT, but the client is `"license": "UNLICENSED"` (client/package.json:25), and the repository has no LICENSE file.

### Two-track preparation

|  | Test ground (integration branch) | Independent implementation |
| --- | --- | --- |
| Purpose | Hand verified PRs to upstream when it comes back | Keep going even if it does not |
| Base | Upstream master + community PRs | Only this spec memo and the MIT contracts |
| License | Same as upstream | Published as MIT from the first line |
| If Gilgamesh comes back | Merge back into upstream | Runs alongside as a second client |

The two tracks share three things:

- The same contracts (MIT), deployed and run by the community on a testnet.
- This spec memo.
- The rule of matching upstream's externally visible shapes (ABI, action byte layout, EIP-712 types, events). Beyond the ABI, conventions fixed outside the chain, such as the body compression format (smltxt), are also to be matched.

### Rules

1. Every change that goes into the test ground is also submitted to upstream as a PR. Then the difference from upstream is always "the list of PRs open on upstream".
2. Contract changes are limited to ones that do not change the externally visible shape. Changes in behaviour are kept in a ledger of differences.
3. Clients and nodes read addresses only from configuration files. When contracts change, there is a mechanism to rebuild the DB.
4. The independent implementation does not refer to the upstream client code.
5. If Gilgamesh comes back, the PRs verified on the test ground are handed to upstream, and development returns to upstream.
6. Whether "the worst case" has happened is judged by several community members, using only externally observable facts (whether there are merges, commits and replies to contact, and for how long). Concrete criteria are to be discussed separately.
7. Mainnet is the point of no return. The conditions for a community mainnet deployment, and how to handle upstream releasing its own mainnet afterwards, are decided in writing and published in advance. Testnet names and CAW are for testing, so losing them in a switch is acceptable.

### Why this is not a split

The independent implementation handles the same contracts, the same names and the same posts. The manifesto says anyone may build their own front end, and multiple clients are what the design expects. Either way it goes, nothing is set up to break.

## Roadmap (draft)

The independent implementation finishes "reading" before moving on to "writing". The test ground (stage 3) needs agreement, so only the discussion of it starts in parallel with stages 1 and 2.

| Stage | Content | Done when |
| --- | --- | --- |
| 0 (2026-10-24) | This spec memo, the principle, the read-only viewer prototype v0 | Done. Two posts on the current testnet were read directly from the chain (batchHash matched) |
| 1. Finish reading | Write-up and implementation of the smltxt format (clean room; see "smltxt format" below) / write-up of the OTHER action prefixes (`tip:`, `hide:`, etc.) / support for the CawActionsERC1271 and ZK paths / put the viewer at a public location | The viewer shows the same bodies as the upstream FE. Share it in the community chat at this point |
| 2. Writing | Wallet connection -> EIP-712 signing as described in this spec memo -> submission | Posts can be made from the viewer, and they display correctly in the upstream FE too (two-way compatibility) |
| 3. Test ground | GitHub organization (with agreement) / integration branch / deployment to a community testnet (with the procedure of proposal 3) | Verified PRs can be run together on the test ground |
| 4. Node side | Write-up of node-side conventions such as images, DMs and notifications, and a minimal node | Everyday use with the independent implementation alone |

- First thing to check in stage 2: `processActions` does not restrict its caller (CawActions.sol:322). So it may be possible to submit directly from a user's wallet without going through a node. Whether that actually works, including what to put in validatorId, has not been checked yet.

## Read-only node prototype v0 (2026-10-25)

A read-only node (caw-reader, MIT) built only on this spec memo and the MIT contracts rebuilt the records from the CawActions deployment (block 45,547,482) exactly as in the DB of node2. Neither the upstream node software nor the upstream client code was used. The comparison was made on 2026-10-25 by building strings of the same form from the node2 DB and the caw-reader DB and comparing their md5.

| Compared | node2 DB | caw-reader |
| --- | --- | --- |
| md5 of the 1,394 actions `(senderId, cawonce)` | `da80cd1047d4ac623aaa8a39d2535383` | `da80cd1047d4ac623aaa8a39d2535383` |
| Counts per type (CAW / LIKE / UNLIKE / RECAW / FOLLOW / UNFOLLOW / OTHER) | 608 / 329 / 18 / 16 / 195 / 9 / 219 | 608 / 329 / 18 / 16 / 195 / 9 / 219 |
| md5 of the 62 names `(tokenId, username)` | `09ad8cd3338173634ff723f39eab60cd` | `09ad8cd3338173634ff723f39eab60cd` |
| Batches not matching batchHash, items for review | — | 0 |

### What the measurements showed

1. **Public RPCs prune old history.** Both `sepolia.base.org` and `base-sepolia-rpc.publicnode.com` return no block or transaction contents before block 46,500,000 (`code 4444` "pruned history unavailable … earliest available 46500000"). `sepolia.base.org` still answers `eth_getLogs` for earlier blocks (up to 200 blocks per call). The actions in the roughly 950,000 blocks from the deployment to 46,499,999 cannot be rebuilt with public RPCs alone. This time, an RPC with full history (Alchemy's Base Sepolia) was queried only when the history was pruned.
2. **Names are not complete on L2 alone.** For 16 of tokenIds 1-62, L1's `CawProfile.usernames(tokenId - 1)` had a name and L2's `CawProfileLedger.usernames(tokenId)` was empty. Four of them (8, 16, 26, 33) never appear in any L2 action either. L1's `nextId` is 63, which matches the 62 names in node2.

### Key points of the design

- If a transaction body or block cannot be fetched, reading does not move forward (the idea of proposal 7 and PR #60). If a log's block hash differs from the current block, that range is read again.
- Only bytes in the calldata matching batchHash are used. Calls through another contract can also be read. The search has an upper limit.
- Action status is decided by rejections on the safe path, the bitmap on the ZK path, and the per-group batchHash on the ERC1271 path. What cannot be decided is recorded as "ambiguous"; one side is never picked silently.
- Names are read from L1, only those added according to `nextId`. A mismatch with L2 is recorded for review.

### Not done yet

- Cross-checking results from multiple RPCs (one RPC is trusted for now).
- Setting the CawActionsERC1271 address (it is read once set after checking it against the deployment record).
- Interpretation of OTHER action bodies (`p:`, `tip:`, `hide:`, etc.), images, DMs and notifications.

## Purpose and scope

This memo writes down the CAW protocol using only the Solidity sources in `solidity/contracts/` as the source. It is the base that lets the "independent implementation" in the principle be written without looking at UNLICENSED code.

| Item | Content |
| --- | --- |
| Repository | GilgameshCaw/Caw |
| Branch and commit | master `97cd13f3` (2026-09-20 08:53 UTC) |
| Used as source | `.sol` files under `solidity/contracts/`. The first line of every file is `SPDX-License-Identifier: MIT` |
| Not used as source | `client/` (`client/package.json` line 25 is `"license": "UNLICENSED"`), `cli/`, `docs/`, deployment scripts |
| LICENSE file at the repository root | None |

- Each statement carries `file:line`. Line numbers are as of the commit above.
- What cannot be read from the sources is not written; it goes to "Open questions and items to check".
- Tests (`test-foundry/`, `echidna/`) and mocks are out of scope, since they do not define the protocol.

The "Proposed changes" near the end are a draft for discussion, not a specification. Only there, past PRs and measurements on nodes were also used as grounds.

## Overall structure

CAW connects the name NFT and vault on L1 (CawProfile) with the ledger (CawProfileLedger) and action processing (CawActions) on L2 through LayerZero. There are three cross-chain message flows; `_lzSend` and `_lzReceive` each appear in four places.

### Contracts and where they live

The location column lists only what is written in code or comments; otherwise it says "not stated".

| Contract | Role | Location | Source |
| --- | --- | --- | --- |
| CawProfile | Name NFT (ERC721, "CAW NAME" / "cawNAME") and CAW vault. OApp | L1 (comment) | CawProfile.sol:30-35, 171 |
| CawProfileLedger | CAW balance per tokenId; copies of owner, name and sessions. OApp | L2 (cross-chain) / same chain as CawProfile (bypassLZ) (comment) | CawProfileLedger.sol:5-7, 23-28 |
| CawActions | Action processing and the checkpoint hash chain | Same chain as the Ledger (comment) | CawActions.sol:49 / CawProfileLedger.sol:246 |
| CawActionsERC1271 | Action processing for contract-owned names (ERC-1271 signatures) | not stated | CawActionsERC1271.sol:5-8 |
| CawActionsArchive | Staking, replication and slashing on the archive chain. Receive-only OApp | Archive chain (comment) | CawActionsArchive.sol:12, 35 |
| CawChallengeRelay | Sends CawActions checkpoints to the Archive. Send-only OApp | L2 (Base) (comment) | CawChallengeRelay.sol:18, 227-229 |
| CawNetworkManager | Network registry (fees, owner, `storageChainEid`) | not stated | CawNetworkManager.sol:18-50 |
| CawProfileMinter | Mint entry point (name validation, CAW burn, tokenId assignment, ETH ZAP, sponsored mint) | not stated | CawProfileMinter.sol:22 |
| CawProfileMarketplace | 0% fee, admin-less name NFT market | not stated | CawProfileMarketplace.sol:16-19 |
| CawProfileURI | On-chain SVG rendering | not stated | CawProfileURI.sol:14-20 |
| CawProfileLens / CawProfileQuoter | Read-only queries, fee quotes | not stated | CawProfileLens.sol:28-32 / CawProfileQuoter.sol:25-26 |
| CawCapOracle | 7-day TWAP price oracle. Only the Ledger can write | L2 (comment) | CawCapOracle.sol:7-17, 143-148 |
| CawL1PriceReader | Reads the cumulative price of a Uniswap V2 pair | L1 (comment) | CawL1PriceReader.sol:7-15 |
| CawBuyAndBurn | Swaps ETH fees to CAW; half to the network, half burned | not stated | CawBuyAndBurn.sol:8-11 |
| PathwayExpander | Owner and LZ delegate of all OApps. Can only add peers for new eids and set DVNs | not stated | PathwayExpander.sol:33-38, 52-56 |
| SmartEOA | EIP-7702 delegation target implementation | not stated | SmartEOA.sol:5-9 |
| SessionMessageParser / SigVerification | Libraries for the Ledger | — | SessionMessageParser.sol:6-8 / SigVerification.sol:8-10 |
| CivicKycVerifier | KYC adapter for the Minter's withdrawal gate | not stated | CivicKycVerifier.sol:15-17 |
| MintableCaw | Test ERC20. Must not be deployed on mainnet (comment) | — | MintableCaw.sol:8-12 |

### Cross-chain messages

1. **L1 CawProfile -> L2 CawProfileLedger** (deposits, mints, authentication, owner updates)
   - Sent from one `_lzSend` (CawProfile.sol:1035). The content is `abi.encodePacked(uint256 cumulative, uint32 priceTs, payload)` (:1037).
   - The first 36 bytes are an L1 price sample. `payload` is built with `abi.encodeWithSelector`.
   - Four selectors are sent (CawProfile.sol:102-105): `lzDepositMintSession(uint32,uint32,uint256,string,address,uint64,uint256,uint64,uint32[],address[],uint64[])`, `updateOwners(uint32[],address[],uint64[])`, `setAllowFreeAuth(uint32,bool,uint64)`, `setNetworkTipTarget(uint32,uint256,uint64)`.
   - Receiving side (CawProfileLedger.sol:972-1054):
     - Passes the price to `capOracle.recordSample`. Failures are ignored.
     - Returns without doing anything if shorter than 40 bytes (:1016).
     - Checks the selector against a whitelist (:1057-1063).
     - Delegatecalls itself. On failure it reverts, and the channel stops (:1047-1053).
2. **L2 CawProfileLedger -> L1 CawProfile** (withdrawals)
   - CawActions (:1933-1941) or CawActionsERC1271 (:120) calls `Ledger.setWithdrawable` (CawProfileLedger.sol:1105-1119).
   - The Ledger sends it to L1 as `setWithdrawable(uint32[],uint256[])` (:1116, 1139-1149). With bypassLZ, it calls directly (:1114).
   - L1 reverts on any other selector (CawProfile.sol:975). On receipt, it adds to `withdrawable[tokenId]` and subtracts from the total held for the source eid (:853-861).
3. **L2 CawChallengeRelay -> archive chain CawActionsArchive** (challenges)
   - Two kinds: `MSG_CHALLENGE=1` (CawChallengeRelay.sol:128, 184) and `MSG_NONEXISTENCE=2` (:151-157).
   - The Archive handles `_processChallenge` in try/catch. On failure it emits `ChallengeDeliveryFailed` (CawActionsArchive.sol:480-497).
   - The Archive sends no messages back.

## Names (username NFTs)

Names are NFTs issued by CawProfile on L1, and the only mint entry point is CawProfileMinter. A name is 1-255 bytes of `0-9` and `a-z`, and minting requires burning CAW depending on the length. Owner changes reach the L2 Ledger with a delay.

### Mint entry points

- The mint functions on CawProfile can be called only by the Minter (CawProfile.sol:250, 282, 343).
- For oneself: `mint` / `mintAndAuth` / `mintAndDeposit`. Each calls the `*For` variant with recipient=msg.sender (CawProfileMinter.sol:157-167).
- For others: `mintFor` / `mintAndAuthFor` / `mintAndDepositFor`. The caller pays the burn and the deposit in CAW (:216-239).
- Buying with ETH (ZAP) swaps WETH->CAW on Uniswap V2 first (:447-525).
- Sponsored: `mintAndDepositSponsored` (:619-697). The recipient must be a contract (:632). Permission is checked with EIP-712, ERC-1271 and the ISmartEOA nonce (:638-652, 835-852).

### Name rules and price

- A taken name cannot be minted again: requires `idByUsername[username] == 0` (CawProfileMinter.sol:383).
- Length 1-255 bytes, each byte `0-9` (48-57) or `a-z` (97-122) (`isValidUsername`, :396-409).
- Burn address: `0xdEAD000000000000000042069420694206942069` (:390).
- Burn amount: `costOfName` (:860-896). The unit is CAW; the actual value is this times `10**18`.

| Name length | CAW burned |
| --- | --- |
| 1 character | 1,000,000,000,000 |
| 2 characters | 240,000,000,000 |
| 3 characters | 60,000,000,000 |
| 4 characters | 6,000,000,000 |
| 5 characters | 200,000,000 |
| 6 characters | 20,000,000 |
| 7 characters | 10,000,000 |
| 8 or more | 1,000,000 |

- In addition, per-network ETH fees (mint / auth / deposit) apply (CawProfile.sol:254, 288-292, 360-367). `payFee` credits the same amount to feeAddress and buyAndBurn and returns a total of `fee*2` (:434-442).

### tokenId assignment

- `nextId()` is `usernames.length + 1` (CawProfile.sol:527-529), so ids are assigned from 1 upwards.
- The Minter registers this value in `idByUsername` (CawProfileMinter.sol:392-393). CawProfile does `usernames.push` and `_mint` (CawProfile.sol:251-252).

### Transfers and their reflection on L2

- Every transfer runs `_afterTokenTransfer` (CawProfile.sol:875-884). For each chain the token has chosen, one of these happens:
  - On the same chain as mainnet, `Ledger.setOwnerOf` is called synchronously.
  - Otherwise, it is queued in `pendingTransfers` and `TransferPendingSync` is emitted.
- Queued entries are carried as `updateOwners` with the next LZ message to that chain, at most 50 at a time (`transferUpdateLimit`, :151, 886-888). The stamp is L1's `block.number` (:913-936).
- Triggers: `transferAndSync` (:792-809), `syncTransfer` (:817-820), `withdrawTo` (:763), and piggybacking on mint, auth and deposit messages (:311, 394, 601, 695).
- `_setOwnerOf` on L2 (CawProfileLedger.sol:681-701):
  - If the stamp is not newer than the previous one, it is silently dropped.
  - When the owner changes, the previous owner's session epoch (`ownerSessionEpoch`) and the token's session epoch (`tokenSessionEpoch`) are advanced by one. This invalidates the previous owner's sessions.
- Cross-chain, the NFT moves immediately but L2 keeps the previous owner until the LZ message arrives. This gap is written as an accepted premise (CawProfile.sol:780-791, comment).

### Storage on L2 (CawProfileLedger)

| Variable | Content | Source |
| --- | --- | --- |
| `ownerOf[tokenId]` | Owner. address(0) if not yet synced | CawProfileLedger.sol:77 |
| `usernames[tokenId]` | Name | :78 |
| `authenticated[net][id]` | Whether authenticated to the network | :81 |
| `cawOwnership[tokenId]` | Share of the balance. Balance = cawOwnership x rewardMultiplier / precision | :98, 351-353 |
| `sessions` | Sessions | :123-133 |
| `lastOwnerUpdateBlock[tokenId]` | Last applied stamp | :141 |

`getTokens` reads them in bulk (:316-329).

## Action format

There are 8 kinds of actions, each represented by a struct called `ActionData`. For submission they are packed into a variable-length byte string (packedActions). One submission can carry at most 256 actions, and a body is at most 420 bytes.

### Kinds (enum ActionType, CawActions.sol:83)

| Value | Name | Value | Name |
| --- | --- | --- | --- |
| 0 | CAW | 4 | FOLLOW |
| 1 | LIKE | 5 | UNFOLLOW |
| 2 | UNLIKE | 6 | WITHDRAW |
| 3 | RECAW | 7 | OTHER |

### Struct ActionData (CawActions.sol:85-95, in this order)

| Field | Type | Notes |
| --- | --- | --- |
| actionType | ActionType (uint8) |  |
| senderId | uint32 | tokenId of the acting name |
| receiverId | uint32 | Target name |
| receiverCawonce | uint32 | Part of the signature and hash, but its use cannot be determined from the contracts (see open questions) |
| networkId | uint32 |  |
| cawonce | uint32 | Replay-protection number |
| recipients | uint32\[\] | tokenIds of payment recipients |
| amounts | uint64\[\] | Whole CAW units. Multiplied by `10**18` on chain (:93 comment) |
| text | bytes | "UTF-8 compressed with smltxt" (:94 comment) |

### Byte layout of packedActions

A 2-byte `uint16 actionCount` comes first (:330), followed by the actions. All values are read big-endian (decoder at :1766-1831).

| Offset | Bytes | Content |
| --- | --- | --- |
| +0 | 1 | actionType |
| +1 | 4 | senderId |
| +5 | 4 | receiverId |
| +9 | 4 | receiverCawonce |
| +13 | 4 | networkId |
| +17 | 4 | cawonce |
| +21 | 1 | number of recipients N |
| +22 | 1 | number of amounts M (0, N or N+1) |
| +23 | 4xN | recipients |
| then | 8xM | amounts |
| then | 2 | body length T (uint16) |
| then | T | body |

Signatures are passed in a separate byte string (sigs). It starts with `uint16 numGroups`; each group is 67 bytes: `[2 groupSize][1 v][32 r][32 s]` (:307-316, 701-704). groupSize 1 means a per-action signature; 2 or more means a batch signature (:729-733).

### Conditions checked (all in code)

- actionCount is 1-256 (:331-332). The number of groups is 1 to actionCount, and the groupSizes sum to actionCount (:336, 347).
- No trailing bytes remain (:352).
- The body is at most 420 bytes (:1300).
- At most 10 recipients (:1672). The number of amounts is N or N+1 (:1674-1676).
- networkId is the same for all actions in one submission (:923-928).
- Within a batch-signature group, senderId is the same and cawonce increases consecutively (:827-830).

### Entry points (externally callable functions)

| Function | Caller restriction | Source |
| --- | --- | --- |
| `processActions(uint32 validatorId, bytes packedActions, bytes sigs, uint256 withdrawFee, uint256 withdrawLzTokenAmount) payable` | No caller check. One failure reverts everything | CawActions.sol:322-396 |
| `processActionsWithZkSigs(...)` | No caller check. Refused if the ZK verifier is not set | :428-437 |
| `safeProcessActions(...)` | No caller check. Isolates failures per group and emits `ActionRejected` | :939-1065 |
| `CawActionsERC1271.processActionsERC1271(...)` | No caller check. Accepts variable-length signatures | CawActionsERC1271.sol:75-104 |

### Processing per kind (`_applyAction`, CawActions.sol:1290-1434)

Three things are checked first (:1297-1300): the cawonce is unused; the sender is authenticated on the network or `allowFreeAuth` is true; the body is at most 420 bytes.

| Kind | Base amount (CAW) | Split | Source |
| --- | --- | --- | --- |
| CAW | 5,000 | All distributed to holders | :1309-1312 |
| LIKE | 2,000 | 20% distributed, 80% to the target | :1313-1324 |
| RECAW | 4,000 | 50% distributed, 50% to the target | :1325-1330 |
| FOLLOW | 30,000 | 20% distributed, 80% to the target. Following oneself is refused | :1331-1336 |
| UNLIKE / UNFOLLOW | none | — | :1350-1358 |
| WITHDRAW | — | Deducted from the L2 balance; a withdrawal to L1 is sent at the end of the submission | :1337-1338, 385-395, 1933-1941 |
| OTHER | — | Processed only when the body is `qs:` (session registration) or `qx:` (revocation); otherwise nothing happens | :1339-1349, 1452-1489 |

- The actual amount is `min(base amount, ETH-denominated cap converted at the price)`. If the conversion yields 0, it is 1 (`_getCost`, :1267-1279).
- "Distributed" means raising the holders' balance multiplier (rewardMultiplier) (CawProfileLedger.sol:388-408).
- When there is one more amount than recipients, the last one is a tip to the validator (CawActions.sol:1674, 1740-1743).

### Post record (checkpoints)

- For each action, `networkHash = keccak256(previous hash ‖ r ‖ keccak256(bytes of that action))` is updated (:1405-1424).
- Every 32 actions it is stored in `networkHashAtCheckpoint[networkId][count/32]` (:210, 1431-1433). CawChallengeRelay reads this value for a challenge and sends it to the archive chain (CawChallengeRelay.sol:123, 176).

## Signatures

Actions are signed with EIP-712; the domain is `"Caw Protocol"` / `"1"` / chainId / the CawActions address. Signing is done with the name owner's own key or a pre-registered session key (Quick Sign). Replays are prevented by a per-name bitmap (cawonce).

### Domain and types

- Domain: `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)` with `"Caw Protocol"`, `"1"`, `block.chainid`, `address(this)` (CawActions.sol:189-191, 1993-2003).
- CawProfileLedger (session registration) uses a separate domain, with name `"CawProfileLedger"` and version `"1"` (CawProfileLedger.sol:305-306).

The type strings are given as in the code.

```
ActionData(uint8 actionType,uint32 senderId,uint32 receiverId,uint32 receiverCawonce,uint32 networkId,uint32 cawonce,uint32[] recipients,uint64[] amounts,bytes text)
ActionBatch(uint32 senderId,uint32 firstCawonce,uint32 actionCount,bytes32 actionsHash)
SessionDelegation(address sessionKey,uint64 expiry,uint8 scopeBitmap,uint256 spendLimit,uint64 perActionTipRate,uint256 nonce)
RevokeSession(address owner,address sessionKey,uint64 expiry)
TokenSessionDelegation(uint32 profileId,address sessionKey,uint64 expiry,uint8 scopeBitmap,uint256 spendLimit,uint64 perActionTipRate,uint256 nonce)
```

Source: CawActions.sol:192-194, 199-201 / CawProfileLedger.sol:190-200

### How the digest is built

1. **Per-action signature**: structHash is keccak256 of these 10 words (32 bytes each) (CawActions.sol:1516-1536).
   - typeHash, actionType, senderId, receiverId, receiverCawonce, networkId, cawonce
   - `keccak256(abi.encodePacked(recipients))`, `keccak256(abi.encodePacked(amounts))`, `keccak256(text)`
2. **Batch signature**:
   - The hash of each action is **keccak256 of that action's raw bytes in packedActions**, not the EIP-712 structHash (:835).
   - `actionsHash = keccak256(abi.encodePacked(the sequence of action hashes))` (:788).
   - structHash is `abi.encode(ACTIONBATCH_TYPEHASH, senderId, firstCawonce, groupSize, actionsHash)` (:1613-1619).
3. **Final**: `keccak256("\x19\x01" ‖ domain hash ‖ structHash)` (:1989).

### Verification paths

| Path | Content | Source |
| --- | --- | --- |
| ECDSA | If `ecrecover` gives `ownerOf(senderId)`, it is the owner. Otherwise it is checked as a session key | CawActions.sol:1560-1567, 1623 |
| ERC-1271 (inline) | If the owner is a contract, `isValidSignature` is called with a 150,000 gas limit | :223, 1543-1549, 1580-1584 |
| ERC-1271 (separate contract) | CawActionsERC1271 verifies variable-length signatures and passes the actions to CawActions. Session keys cannot be used | CawActionsERC1271.sol:179-185, 310-323 / CawActions.sol:1102-1115 |
| SmartEOA (EIP-7702) | 65 bytes: secp256k1 (low-s only); otherwise WebAuthn P-256 verified with precompile 0x0100 | SmartEOA.sol:175-187, 650-666, 784-789 |
| ZK | Signature verification batched in an SP1 proof. ERC-1271 not supported (comment) | CawActions.sol:453-460, 546-550 |

An expired session key is refused with SessionExpired and does not proceed to the ERC-1271 path (:1574, 1631).

### cawonce (replay protection)

- Stored as a bitmap `usedCawonce[senderId][word]`, with `word = cawonce >> 8` and `bit = cawonce & 0xff`; one word holds 256 (CawActions.sol:104-105, 1954-1964).
- When a word is full, `currentCawonceMap[senderId]` moves to the next word (:1962-1964). `nextCawonce` returns the first free bit in the current word (:1967-1977).
- Whether a cawonce is used is decided by the bit alone. They need not be used in order; the only constraint is consecutiveness within a batch-signature group (:1297, 829).
- When a used cawonce is hit: the normal path reverts the whole submission (:1297); the ZK path skips only that action (:623-627); the safe path rejects only that group (:1042-1062).

### Sessions (Quick Sign)

- Stored as `StoredSession{uint64 expiry, uint8 scopeBitmap, uint32 epoch, uint64 perActionTipRate, uint32 profileId, uint256 spendLimit}` in `sessions[owner][sessionKey]` (CawProfileLedger.sol:118-133). profileId 0 means wallet-wide; non-zero means that name only (:121-122).
- Validity is decided by the epoch (:174-182). Expiry is checked on the CawActions side (CawActions.sol:1564).
- Allowed kinds are given by `scopeBitmap & (1 << actionType)` (CawActions.sol:909, 1565). WITHDRAW (0x40) is removed on every registration path (CawProfileLedger.sol:746, 807, 828, 899).
- Spending accumulates in `sessionSpent[owner][key]`. With `spendLimit > 0`, exceeding it gives SessionLimitExceeded (CawActions.sol:1372-1384).

| Registration path | What is signed | Source (CawProfileLedger.sol) |
| --- | --- | --- |
| `registerSession` | SessionDelegation (EIP-712, matching `sessionNonce`) | :733-761 |
| `registerSessionPersonal` | 13 lines of plain text (EIP-191). The first line is `Enable Quick Sign` | :782-808 / SessionMessageParser.sol:14-27 |
| `registerTokenScopedSession` | TokenSessionDelegation (ecrecover only) | :814-845 |
| `registerSessionFromActions` | OTHER action body `qs:` + addr(20) + expiry(8) + spendLimit(32) + tipRate(8), 71 bytes in total | :886-900 / CawActions.sol:1446, 1477-1483 |
| `registerSessionFromL1` | Only from CawProfile on L1 (bypassLZ) | :624-632 |

Revocation has three ways: `revokeSession` (sent by the owner, :848-862), a `qx:` action (:904-910), and `revokeSessionBySig` (signed by the session key itself, :915-941). When a name is transferred, the previous owner's sessions become invalid through the epoch update (:681-701).

## Events

There are no per-post, per-like, per-follow or per-tip events. The content of actions remains only in the calldata of the submitting transaction (packedActions). A read-only viewer therefore uses `ActionsProcessed` as a marker, fetches the transaction, and decodes the calldata in the format of the previous section.

### Grounds for saying so

- None of the branches of `_applyAction` (CAW :1309, LIKE :1313, RECAW :1325, FOLLOW :1331, WITHDRAW :1337, OTHER :1339, UNLIKE/UNFOLLOW :1350) emits anything. The only emits in CawActions.sol are at :378, 496, 974, 1059, 1216 and 1233.
- `ActionsProcessed` has four arguments: networkId, validatorId, actionCount and batchHash. batchHash is `keccak256(packedActions)` (CawActions.sol:146-151, 382).
- A comment also says that the body is in the calldata of the original transaction, to be fetched with `eth_getTransactionByHash` and checked against batchHash (:138-143).

### Events a viewer watches

| Contract | Event | Use | Source |
| --- | --- | --- | --- |
| CawActions | `ActionsProcessed(uint32 indexed networkId, uint32 indexed validatorId, uint16 actionCount, bytes32 batchHash)` | Marker of a submission; go fetch the calldata | CawActions.sol:146, 378, 974 |
| CawActions | `ActionRejected(uint32 senderId, uint32 cawonce, bytes reason)` | Exclude actions that failed on the safe path (batchHash includes the failed ones) | :157, 1059 / :970-972 comment |
| CawActions | `ActionsProcessedZk(..., uint256 actionsExecutedBitmap, bytes32 batchHash)` | Exclude slots skipped on the ZK path using the bitmap | :253, 496 / :248-252 comment |
| CawActionsERC1271 | `ActionsProcessed(...)` | Emitted from a different address. batchHash is per group | CawActionsERC1271.sol:47, 187-188 |
| CawProfileLedger | `OwnerSet(uint32 tokenId, address newOwner)` | Owner change on L2 | CawProfileLedger.sol:216, 699 |
| CawProfileLedger | `UsernameMinted(uint32 tokenId, address owner)` | A name arrived on L2 | :217, 447, 611, 663 |
| CawProfileLedger | `Authenticated(uint32 cawNetworkId, uint32 tokenId)` | Authentication to a network | :218, 455, 612, 642 |
| CawProfileLedger | `SessionCreated(...)` / `SessionRevoked(...)` | Session registration and revocation (including via `qs:` / `qx:`) | :219-220 |
| CawProfile (L1) | ERC721 `Transfer` and `TransferPendingSync(uint32 indexed tokenId, address indexed from, address indexed to)` | Name transfer on L1, waiting to reach L2 | CawProfile.sol:159, 883 |

### Other events (list only)

- CawActionsArchive: Deposited, Withdrawn, RewardClaimed, SubmissionCreated, ActionsArchived, SubmissionFinalized, ValidatorSlashed, ChallengeHashDelivered, ChallengeDeliveryFailed, ChallengeDropped (CawActionsArchive.sol:161-198, 452, 463)
- CawChallengeRelay: NonExistenceRelayed, ChallengeRelayed, ChallengeBatchRelayed (CawChallengeRelay.sol:57, 64, 72)
- CawProfile: Deposited, FeesAccrued, FeesWithdrawn (CawProfile.sol:160, 422-423). L1 has no withdrawal event; the ERC20 Transfer is meant to serve instead (:161-165 comment)
- CawProfileLedger: Withdrawn, SponsorRepayRegistered, SponsorRepaySwept, SponsorRepayForgiven (CawProfileLedger.sol:228, 545-547)
- CawNetworkManager: 16 kinds, such as network creation, fees, locks and instance registration (CawNetworkManager.sol:133-168, 472)
- CawProfileMinter: WithdrawUnlocked, KycVerifierAdded, SponsorRepaySet (CawProfileMinter.sol:299-300, 699)
- CawProfileMarketplace: 15 kinds, such as listings, sales, bids, offers and payouts (CawProfileMarketplace.sol:98-115)
- CawCapOracle: SampleRecorded (:123) / PathwayExpander: PeerAdded, KycVerifierAdded, DvnEscalated, PathwayConfigured (:106-122) / SmartEOA: Initialized and 7 others (:80-87) / CawBuyAndBurn: BuyAndBurn (:43)

## Permissions

Two kinds of admin permissions remain after deployment: the "add-only" permissions held by the PathwayExpander owner, and the fee and related permissions held by each network's owner. None of the contracts in scope has pause, upgrade or selfdestruct.

### Contract owners

| Contract | Owner | Source |
| --- | --- | --- |
| CawProfileLedger | `renounceOwnership()` at the end of the constructor. No owner | CawProfileLedger.sol:294-295 |
| CawProfile | Moved to PathwayExpander in the constructor | CawProfile.sol:225-227 |
| PathwayExpander | `_owner` given to the constructor (OpenZeppelin Ownable) | PathwayExpander.sol:72, 126 |
| CawActionsArchive / CawChallengeRelay | No transfer or renounce code in this directory. Comments say both "renounce" and "move to PathwayExpander" | CawActionsArchive.sol:28, 229-237 / CawChallengeRelay.sol:101-103 |
| CawCapOracle / CawProfileMarketplace / SmartEOA | No admin (comment) | CawCapOracle.sol:13 / CawProfileMarketplace.sol:16-19 / SmartEOA.sol:11-15 |

### What the PathwayExpander owner can do (onlyOwner)

| Function | Restriction | Source |
| --- | --- | --- |
| `addPeer` / `addPeers` | Only for eids that have no peer yet | PathwayExpander.sol:138, 143-147, 162 |
| `addKycVerifier` | Once per level on the Minter side | :178 / CawProfileMinter.sol:309-317 |
| `configureNewPathway` | Once per (oapp, lib, eid) | :207-221 |
| `addDvnToPathway` | Up to twice | :257-268 |

- Each OApp's `setPeer` can be set only once per eid (`onlyOnce`, CawProfile.sol:233-238 and 4 other places). An existing peer cannot be replaced.

### Settings the deployer can call only once

- `setCawProfile` and `setMinter` on CawNetworkManager (CawNetworkManager.sol:183-200).
- `setCawProfile` on CawBuyAndBurn (CawBuyAndBurn.sol:53-57).

### What a network owner can do (CawNetworkManager)

- Anyone can create a network; the creator becomes its owner (:366, 389).
- Change fees, fee recipient and tip target (:428-653). `lockNetworkFees` fixes them irreversibly (:670-678).
- Transfer the owner (`changeOwner`, :418). `lockNetworkOwnership` fixes it irreversibly (:680-686).
- The gas override (`setGasOverride`) can be changed even after locking; only upwards, up to 100,000 (:119, 698-704).
- There is no function to renounce a network owner.

### Functions with a fixed caller (excerpt)

| Contract | Function | Who can call | Source |
| --- | --- | --- | --- |
| CawActions | `processActions` and other entry points | Anyone (verified by signatures) | CawActions.sol:322, 428, 939 |
| CawActions | `setCapRatio` / `setTipRatio` | The fixed capOracle | :1213-1214, 1229-1230 |
| CawProfile | mint functions | The fixed minter | CawProfile.sol:250, 282, 343 |
| CawProfile | `setWithdrawable` | Via LZ, or the Ledger | :847 |
| CawProfileLedger | `updateOwners` and the other 3 kinds from L1 | Via LZ, or CawProfile with bypassLZ | CawProfileLedger.sol:478, 489, 520, 553 |
| CawProfileLedger | Session registration and revocation (via actions), `withdraw` | CawActions | :893, 905, 1071 |
| CawCapOracle | `recordSample` | The fixed writer (the Ledger) | CawCapOracle.sol:160 |

### delegatecall

Only to itself, with a fixed set of accepted selectors. CawProfile accepts one, `setWithdrawable` (CawProfile.sol:975, 990); CawProfileLedger accepts the five in its allow list (CawProfileLedger.sol:1043, 1057-1062).

## Proposed changes (draft)

From here on, this is not a description of the specification but proposals of what would be better changed in a new deployment. None is a decision; they are placed here as a draft for discussion. The grounds are limited to reviews of past PRs and measurements on nodes.

| # | Proposal | Size of change | Difference from upstream (externally visible shape) | Grounds |
| --- | --- | --- | --- | --- |
| 1 | Fix the unit of the session spend cap | 1 line | Unchanged; only the cap value changes | A registration above the cap went through on node2 (2026-09-09) |
| 2 | Settle on one meaning of "no limit (spendLimit=0)" | A few lines | Unchanged as long as clients do not send 0 | "No limit" always failing (2026-09-09) |
| 3 | Fix the deployment and wiring procedure, and read everything back before release | No contract changes | Unchanged | In the partial redeployment of 2026-08-04 the wiring broke and could not be fixed by configuration |
| 4 | Prevent duplicate instance registration in the contract | A few lines | Unchanged; only re-registration with the same owner and URL behaves differently | 22 of 28 registry entries were duplicates (2026-08-03) |
| 5 | Decide and publish the final form of admin permissions | Operations (a few lines if needed) | Unchanged if operations only | "Permissions" in this memo, PR #334 |
| 6 | Discuss how the body limit (420) is counted before deployment | From one constant | Unchanged if only the constant; changes if the way of counting changes | The limit is in bytes; the manifesto says "characters" |
| 7 | Specify where action contents live (calldata) | Documentation only | Unchanged | PR #60 |
| 8 | Align comments with the implementation | A few comment lines | Unchanged | The investigation for this memo |

### 1. Unit of the session spend cap

- `MAX_SESSION_SPEND` is `1_000_000_000 ether` (1e27, CawProfileLedger.sol:206). The comment says "1B CAW", but the spendLimit it is compared with is in whole CAW units (:129), and they are compared directly (:712, 827).
- Measured on node2 (2026-09-09): a session registration with the $100 preset (3.6B CAW) succeeded, above the 1B CAW cap in the comment.
- Proposal: remove `ether` (1 line). This value bounds the damage if a session key leaks, so from a defensive point of view it matters that it actually takes effect.

### 2. Meaning of "no limit"

- Plain-text registration (`registerSessionPersonal`) rejects a spend cap of 0 with BadParse (SessionMessageParser.sol:165).
- On the other hand, EIP-712 registration says "0 = unlimited" in a comment (CawProfileLedger.sol:731), and CawActions also treats 0 as unlimited (CawActions.sol:1377).
- Measured on node2 (2026-09-09): the FE's "No limit" sends 0, so registration always failed (revert data `0xb3ed74d7` = `BadParse()`).
- Proposal: align them one way. In the community chat, the discussion was heading towards "drop No limit and offer only capped choices". Following that, remove the branch that treats 0 as unlimited, and require "at least 1 and at most the cap" on every registration path. The damage from a leaked key is then always bounded, which is the safer side from a defensive point of view as well.

### 3. Deployment and wiring procedure

- All wiring between contracts is one-time: `setPeer` (`onlyOnce`), `setCawProfile` / `setMinter` on CawNetworkManager, and `setCawProfile` on CawBuyAndBurn (see "Permissions" in this memo).
- In the partial redeployment of 2026-08-04, the peer of CawProfileLedger on L2 was stuck pointing at the old L1. `OnlyOnce: already called` was confirmed by eth\_call simulation; it could not be fixed by configuration, and a full redeployment followed (2026-08-06).
- The cause was that the deployment script baked values predicted from nonces, or values from the previous run, into constructors. A full deployment from an empty state was confirmed on a fork to wire everything correctly.
- Proposal: keep the one-time design. That an admin cannot replace peers later is a guarantee that message destinations cannot be changed at will. Instead, fix and publish these two steps as the procedure:
  1. Deploy everything at once from an empty state.
  2. Before release, read back the references of all contracts (peers and functions that return addresses) and check them.

### 4. Duplicate instance registration

- `registerInstance` issues a new number on every call, even for the same owner and URL (CawNetworkManager.sol:727-737). Details such as the URL remain only in events (:153-155).
- Measured (2026-08-03, a full survey from the registry's deployment block): 22 of all 28 entries (81%) were duplicates, and there were 5 real nodes. The cause was the node-side self-registration check, which went on to register even when its log scan was incomplete.
- Proposal: for the same (owner, networkId, URL), return the existing number instead of issuing a new one. Add one mapping, and re-point it when the URL is changed with `updateInstance` (a few lines).
- Because the key includes the owner, nobody can take someone else's URL first. Even with a node-side bug, duplicates do not pile up. Nodes can also check their own registration with a view function, without scanning past logs. Registration costs one more storage write in L1 gas.

### 5. Final form of admin permissions

- Two permissions remain in the current sources:
  - The PathwayExpander owner: add-only (PathwayExpander.sol:138-268).
  - Each network owner: the gas override can be changed even after locking. There is no function to renounce the owner itself (CawNetworkManager.sol:680-704).
- The owners of CawActionsArchive and CawChallengeRelay cannot be determined from the sources.
- That "locking a network is not renouncing ownership" was also covered in PR #334 (Xubu-Trad).
- Proposal: before deployment, publish a table of "which permission is held by whom and when it is renounced". After deployment, publish the results read back on chain. Whether to add a renounce function for network owners is to be discussed.

### 6. Body limit (420)

- The check is `text.length > 420` (CawActions.sol:1300), counting bytes. The same check was confirmed in the bytecode of the previous generation (2026-07-30).
- The manifesto and help texts say "420 characters" (confirmed in each language's translation file, 2026-08-17).
- Counted as at that time (UTF-8 bytes), Japanese fits about 140 characters.
- However, according to the comments in the current sources, bodies are compressed with smltxt (:94). The limit applies to the compressed size, so how many Japanese characters actually fit depends on the compression and has not been measured yet.
- There is Jin's view (Japanese carries more information per character, so a byte-based limit is fine) and the precedent of X's weighting (a CJK character counts as 2).
- Proposal: rather than deciding a number here, list it as an item to discuss and decide once before it becomes immutable. Changing only the constant does not increase the gas of the check.

### 7. Where action contents live

- Currently, action contents are not emitted in events but placed in the calldata of the submitting transaction. Events carry only the hash (CawActions.sol:138-151).
- V1 emitted the contents in the event, as `ActionsProcessed(bytes packedActions)` (confirmed in node1's sources, 2026-08-16).
- In the current form, nodes must fetch the transaction body. A bug where a node silently moved on when it could not fetch it, so actions could be lost, was fixed in PR #60 (Jin).
- Proposal: putting the contents back in events increases log gas for every submission. Assuming a large growth in users, the proposal is to keep the current form, and to specify "do not move forward if the transaction body cannot be fetched" (the approach of #60) as part of the node and viewer specification.
- Measured (2026-10-25): the public RPCs `sepolia.base.org` and `base-sepolia-rpc.publicnode.com` return no transaction contents before block 46,500,000. With contents only in calldata, a new node cannot rebuild the actions of the roughly 950,000 blocks right after deployment without an RPC that has full history ("Read-only node prototype v0").

### 8. Mismatches between comments and implementation

- For each item of the next section, "Places where code and comments disagree", fix the comment to match the code. Only for the shape of WITHDRAW, check which one is intended before fixing.
- One more: the comment at CawProfile.sol:1063-1065 says "authSelector raised to 85k", but the current values are all 250,000 (:217-220).

## Open questions and items to check

The biggest one is that the body compression format (smltxt) is not in the contracts, and its implementation in the repository is UNLICENSED. To build a read-only viewer, this has to be settled some other way.

### To decide before building a viewer

- [ ] **Body compression format**: the contracts only have the comment "UTF-8 compressed with smltxt" (CawActions.sol:94). Line 27 of `smltxt/package.json` in the repository is `"license": "UNLICENSED"`, so it cannot be used as a source. Choose between writing up the format from real on-chain data and defining a new uncompressed format. Measured (2026-10-24, read-only viewer prototype v0): two test posts on the current testnet had bodies of 25 and 3 bytes, and neither could be read as UTF-8. Bodies on chain really are compressed.
- [ ] **Meaning of OTHER action bodies**: only `qs:` and `qx:` are processed on chain. A comment says the rest are interpreted off chain, with `p:`, `tip:`, `vote:`, `hide:`, `pi:` and `xpi:` as examples (CawActions.sol:1340-1341). The format of each is not in the contracts.
- [ ] **Use of receiverCawonce**: it goes into the signature and hash, but no state-changing logic in the contracts uses it. What it refers to cannot be determined from the contracts.
- [ ] **Deployed addresses and chains**: not in the sources. Collect them from the chain (or the deployment records).

### smltxt test vectors (observed)

Pairs of bytes read from the chain and the body the poster actually typed. Once the format is written up, it is checked against these pairs. Posted from node2 to the current testnet on 2026-10-24.

| Typed body | Characters | UTF-8 bytes | Compressed bytes | Body on chain | cawonce |
| --- | --- | --- | --- | --- | --- |
| `a` | 1 | 1 | 2 | `0x4760` | 4 and 7 (posted twice, same value) |
| `z` | 1 | 1 | 2 | `0x37d0` | 6 |
| `aa` | 2 | 2 | 3 | `0x4758a0` | 5 |
| `test` | 4 | 4 | 3 | `0x2519d8` | 2 |
| `Test` | 4 | 4 | 3 | `0x1259d8` | 8 |
| `test test` | 9 | 9 | 5 | `0x2519d2f5d8` | 9 |
| `hello world` | 11 | 11 | 6 | `0xbdd5f39c115c` | 10 |
| `https://caw.is` (replaced on chain by `https://tencawffee.com/s/knTDbd`) | 14 (30 after replacement) | 14 (30 after replacement) | 20 | `0xbdffcbfe0866d79f7d17caad88eb617622fc74a7` | 14 |
| `あ` | 1 | 3 | 2 | `0xf84c` | 11 |
| `漢` | 1 | 3 | 3 | `0xcd6eb2` | 12 |
| `👍` | 1 | 4 | 4 | `0xdabbd848` | 13 |
| `ギルさん起きてwakeup(test)` | 19 | 33 | 25 | `0xf4b9fdc77c35f4eaeb0624f809f15ef5cbce2a4e43e796edb1` | 3 |

Properties observed (limited to what these 12 pairs show directly):

- The same body gives the same bytes (`a` posted twice, both `0x4760`).
- Bodies with the same beginning share their first bits after compression. `test` and `test test` share the first 20 bits; `a` and `aa` share the first 10 bits.
- Upper case changes the bits from the start (`test` and `Test` share only the first 2 bits).
- It is not a simple scheme with a fixed number of bits per character (splitting `test` into 6-bit units gives 9 and 24 for the two `t`s).
- The length grows or shrinks depending on the body. English words shrink (`hello world`, 11 -> 6 bytes). A single character grows (`a`, 1 -> 2 bytes). For Japanese, `あ` went 3 -> 2 bytes and `漢` 3 -> 3 bytes.
- **The FE replaced the URL with the node's short URL before posting.** The post typed as `https://caw.is` was `https://tencawffee.com/s/knTDbd` on chain (2026-10-24, confirmed in both directions by smltxt decoding and re-encoding). An earlier statement that "the URL grows from 14 to 20 bytes" was wrong and has been corrected.
- The emoji was originally planned to be 🐦, but 👍 was actually posted.

### To check on chain

- [ ] Who is the current owner of PathwayExpander (it is the owner of CawProfile).
- [ ] Who owns CawActionsArchive and CawChallengeRelay, and whether ownership was renounced. This is in the parent (LayerZero's OApp), so the sources alone do not tell.
- [ ] Whether each network's fees and owner are locked (`networkFeesLocked` / `networkOwnershipLocked`).

### Places where code and comments disagree

- **Shape of WITHDRAW**: the comment (CawActions.sol:1682-1685) gives "empty recipients and amounts==\[X\]" as the correct shape. But the code rejects that shape at :1687.
- **Unit of the session spend cap**: `MAX_SESSION_SPEND` is `1_000_000_000 ether` (1e27, CawProfileLedger.sol:206). spendLimit is in whole CAW units (:129 comment), and they are compared directly (:712, 827).
- **ERC-1271 gas limit**: the comment says 50k (CawProfileLedger.sol:724); the value is 150k (SigVerification.sol:32).
- **A path where the name does not reach L2**: `CawProfile.mint` sends no LZ message (CawProfile.sol:256). Later authentication and deposits send an empty username (:602, 696). Whether this is intended is unknown.
- Measured (2026-10-25): for 16 of tokenIds 1-62 (7, 8, 11, 12, 16, 18, 19, 20, 21, 26, 28, 32, 33, 34, 42, 49), L1's `CawProfile.usernames(tokenId - 1)` had a name and L2's `CawProfileLedger.usernames(tokenId)` was empty. To complete the names, L1 must also be read.
- **Difference between the quote and the actual send**: the quote payload of CawChallengeRelay has no kind tag (uint8), but the actual send does (CawChallengeRelay.sol:128, 184, 203, 220).

### Points that rely on language semantics

- That `keccak256(abi.encodePacked(uint32[]))` and `uint64[]` pad each element to 32 bytes is a Solidity rule. This is why they match the EIP-712 array hashes (CawActions.sol:1517-1518). When writing a client, lay the elements out 32 bytes each and take keccak256.

### To ask Gilgamesh (statistics table versions)

Posts stay on chain as bytes, but reading them needs the same statistics table used to compress them. If the table were lost or replaced, posts might become unreadable even though they are not deleted. Based on Jin's suggestion (2026-10-24), three questions:

1. Are there plans to change the table in the future?
2. If it changes, will the old table be kept for reading old posts? Will posts carry a version mark?
3. Is there any intention to record the table's hash on chain, or to store it in multiple places?

Along with these, ask for permission or a license to use smltxt and the statistics table in an independent implementation. That would be the fundamental solution.

**License check (2026-10-25, PR #364)**: PR #364 "Add MIT LICENSE and align client/smltxt license fields" was submitted upstream. It proposes adding an MIT `LICENSE` to the repository and changing `"license"` in `client` and `smltxt` from `UNLICENSED` to `MIT`, with no code changes. A merge would mean permission; a close or a comment would also be an answer. The PR body also offers the option of leaving smltxt and the statistics table out of scope. Before submitting, agreement was obtained from Jin (Zinsanjp), nyarome (nyaromesama) and RAZ (Xubu-Trad). master at the time of submission was `97cd13f3`.

## smltxt format (template for the write-up)

This section is a template for a person reading upstream smltxt to write the format down in prose and tables. The implementer does not look at the smltxt code and implements from this section only (clean room).

**Purpose of the analysis (recorded 2026-10-24)**: this analysis is for keeping compatibility with upstream posts and is not for profit. The results go back to upstream if upstream comes back.

### Rules for the write-up

- Do not copy code. Describe what it does in prose, tables and byte diagrams.
- If there is a large table such as a dictionary or code table, first write only whether it exists and its size, and discuss before copying anything.
- Make what is written checkable against the pairs in "smltxt test vectors" above.

### Items to write up

1. Overall structure: is there a marker or flag at the start? If so, how many bytes or bits, and what it means.
2. Uncompressed bodies: are bodies ever stored uncompressed? If so, how to tell.
3. Coding unit: per character, per word or per byte? Bit order (from the high or the low bit).
4. Code tables and dictionaries: are there any? If so, their size and where they come from (do not copy the contents).
5. Handling of non-ASCII characters such as Japanese.
6. How the end is detected, and what happens to leftover bits.
7. Relation to the 420-byte limit: the limit applies to the compressed size (CawActions.sol:1300).
8. Two of the test vectors decoded by hand following this section.

### Write-up results (2026-10-24)

ChatGPT Codex read upstream smltxt (`97cd13f3`), ran it, and wrote reports; Ten received them after checking that they contained no code and no table contents. The key points are below. 11 of the 12 test vectors matched (the remaining one is due to the short-URL replacement shown in the table above).

1. **Overall structure**: the code bits of the body -> a terminating bit (`1`) -> `0`s up to the byte boundary. There is no marker, flag, length or table identifier at the start. The last byte of valid output is never 0. The empty string is `0x80`.
2. **Uncompressed bodies**: smltxt has no path to store a body uncompressed, and no flag to tell them apart.
3. **Coding unit**: one UTF-8 byte at a time (256 symbols). The state is decided by the "class" of the previous 2 bytes, and each state's Huffman tree gives the code. Bits run from the high bit of each byte; the left branch of the tree is 0 and the right is 1. Codes are not aligned to byte boundaries.
4. **Statistics table**: per state, the frequency of the next byte (256 symbols) rounded to one byte. Size: 1,521 states x 256 = 389,376 bytes. A Huffman tree is built per state from the table. The table is learned from post bodies, and the original training data is not in the repository, so the same table cannot be rebuilt.
5. **Non-ASCII characters**: no special handling; each UTF-8 byte is coded. In the state calculation, all such bytes are classed as "other".
6. **End detection**: drop the 0s running from the low bit of the last byte, and the 1 just before them; the rest is the body. Running out of bits in the middle of a code is an error. There is no checksum.
7. **Case and repetition**: codes distinguish upper and lower case, but the state calculation does not. There is no special handling of URLs and no back-references (dictionary) for repetitions.
8. **Hand check**: `a` is code `0100011101` (10 bits) + terminator `1` + `00000` = `0x4760`. `test` is `0010010100`, `0110`, `0111`, `01` + terminator `1` + `000` = `0x2519d8`.

How the state is decided:

| Class of the previous byte | Class number |
| --- | --- |
| Other (including newline, tab and non-ASCII) | 0 |
| Letters a-z, A-Z (upper and lower case share a number) | 1-26 |
| Space | 27 |
| Digits 0-9 | 28-37 |
| Printable ASCII other than the above (punctuation, brackets, slash, etc.) | 38 |

- State number = older class number x 39 + newer class number (1,521 states in total). A body starts in state 0.
- How frequencies are rounded: per state, scale so that the most frequent byte is one billion, then round to 0-255 on a logarithmic scale from 10 to one billion. To restore, use the scale that divides 10 to one billion into 255 equal-ratio steps.
- How the Huffman tree is built (ordering with equal weights): leaves in ascending byte order -> re-sort by ascending weight, keeping the order of equal weights -> take the two smallest, the first as left and the next as right -> the parent's weight is the sum of the two -> append the parent at the end, then re-sort (with equal weights, existing nodes come first).

### Open issue: handling the statistics table

- The decoding procedure can be implemented from this section alone. However, reading existing posts requires the same statistics table as upstream (389,376 bytes).
- A table re-learned from a different set of posts is not compatible with existing posts.
- **Decision (2026-10-24)**: the independent implementation (the viewer) does not include the statistics table. It loads it at run time from `smltxt/src/tableData.ts` at commit `97cd13f3` of the upstream public repository, and uses it only when the SHA-256 of the decoded table is `3b1111b5c9e2dbc249f93f1bd46cc2ce8d663e44cefc585a9288632fff024e30`. What to do if the upstream repository disappears is not decided now; it is to be discussed if that actually happens (Jin's suggestion, 2026-10-24).
  - **Implementation and check results (2026-10-24)**: with a decoder written only from the text of this section, all 12 test vectors decoded back to the original bodies (for the URL, the shortened string). The empty body (`0x80`) and the rejection of input whose last byte is 0 were also checked.
- **Source policy (2026-10-24, Jin's suggestion)**: the statistics table is fetched only from what upstream itself distributes. No third-party mirrors are added, because whoever adds a mirror becomes a redistributor.
- **Change history of the table (checked 2026-10-24)**: only one commit touched `smltxt/src/tableData.ts`: `b389d1d3` (2026-04-15, the commit that introduced smltxt). There has been no change up to master `97cd13f3` (2026-09-20). Also, compressed output carries no version number, flag or code-table identifier (Codex report 1). If the table were replaced, a post would give no way to tell which table to read it with.
- **Comparison with upstream (2026-10-24, Jin)**: Jin compared the viewer's decoding part (from `// <smltxt>` to `// </smltxt>`) side by side with smltxt/src of upstream `97cd13f3`. No identical passages were found, and the structure, naming, error handling and return values differed. What matched were the parts fixed by compatibility (the 39 classes and the two-previous-bytes context, the class mapping, weight restoration, tree construction, bit order). This is a comparison of appearance and structure, not proof that nothing was copied. No legal judgement was made.
- **Record**: the original texts of the two requests to Codex and the two reports are kept unedited together in `smltxt-cleanroom-record-2026-10-24.txt`.

## OTHER actions and body conventions (observed in real data)

For the bodies of OTHER actions, the contracts describe only `qs:` and `qx:`. So on 2026-10-25, the forms were observed using only the 1,394 actions caw-reader rebuilt from the chain (md5 matches node2). The upstream client code was not looked at. Only what was checked against the real data is written below. The names of the uses were not checked.

### receiverCawonce

`(receiverId, receiverCawonce)` of LIKE, UNLIKE and RECAW points to one of receiverId's actions by its cawonce. This was the mapping in the real data for the use of receiverCawonce listed under "Open questions and items to check".

| Action | Points to a CAW | Points to a RECAW | Points to nothing | Points to a later action |
| --- | --- | --- | --- | --- |
| LIKE (329) | 328 | 1 | 0 | 0 |
| UNLIKE (18) | 17 | 1 | 0 | — |
| RECAW (16) | 16 | 0 | 0 | 0 |

### OTHER prefixes

All 219 could be read as smltxt. There was not a single raw `qs:` / `qx:` (the forms the contract processes, CawActions.sol:1452-1489).

| Body form | Count | Mapping checked in the real data |
| --- | --- | --- |
| `hide:caw:N` | 50 | In 46, (sender, N) is the sender's own CAW. The rest: 1 UNFOLLOW, 1 RECAW, 2 with no match |
| `hide:recaw:a:b` | 11 | In all 11, (a, b) is a CAW of a, and the sender has a RECAW pointing to (a, b) |
| `tip:a:b` | 47 | In all 47, a = receiverId, b = receiverCawonce, and (a, b) is a CAW of a |
| `tip:` | 11 | receiverCawonce is 0. recipients\[0\] = receiverId |
| `vote:N` | 59 | In all 59, (receiverId, receiverCawonce) is a CAW. N is 0 or 1 |
| `vote:` | 1 | Same as above, with N empty |
| `p:{…}` | 29 | The body is `p:` + JSON. Only 6 keys: n (15), a (8), c (8), d (5), l (2), w (1) |
| `pi:N` | 5 | Only 1 has (sender, N) as a CAW. In 4, N is larger than the sender's highest cawonce, so there is no match |
| `xpi:N` | 1 | (sender, N) is a CAW. A `pi:` with the same N comes earlier |
| `sp-i:a:b` | 5 | b is 6 in all 5. recipients are all \[3\], with one amount. A prefix not in the contract comment (CawActions.sol:1340-1341); mapping not checked |

- Amounts: all 58 `tip:` have one recipient and two amounts (the first to the recipient, the second 1000). When amounts has one more entry than recipients, the last is a tip to the validator ("Processing per kind", CawActions.sol:1674, 1740-1743).
- For the 4 `pi:N`, N does not correspond to any (sender, cawonce) on chain. What N refers to cannot be known without looking outside the chain. Left as an item to check with upstream.

### Conventions inside CAW bodies

The bodies of the 8 CAWs that `vote:` points to all end in the form `::poll:option:option::::pd:1d::` (one is followed by `::pm::`). Example: `テストアンケート５\n::poll:選択肢A:選択肢B::::pd:1d::`. Other values of `pd:` and `pm`, and polls with three or more options, do not appear in this data.

### Limits of this observation

- The material is only the 1,394 actions on the current testnet. Other values and forms cannot be ruled out.
- Uses such as "hide" and "vote" are readings of the prefixes' wording and were not checked. The implementation interprets only the forms whose mapping was checked, and keeps everything else as is.

## Comparison with likes, tips and votes in node2 (2026-10-25)

caw-reader's counts were compared one by one with the `Like`, `Tip` and `Vote` tables in the node2 DB, down to "which post of whom". For likes and tips, the differences were explained down to their contents. For votes, how node2 keeps them could not be explained from chain data.

|  | node2 | caw-reader | Matched | Differences |
| --- | --- | --- | --- | --- |
| Likes (account x post) | 289 | 303 | 289 | 14 only in caw-reader |
| Tips (per recipient) | 63 | 63 | 62 | 1 linked to a different post |
| Votes (account x poll) | 11 | 20 | — | See below |

### Likes

- All 289 in node2 are also in caw-reader.
- The 14 only in caw-reader are each a single LIKE with no UNLIKE, pointing to a CAW. The likers are tokenId 29 (12) and 3 and 25 (1 each).
- These 14 actions are also in node2's `Action` table (the md5 of the 1,394 actions matches). node2 has the actions but no `Like` rows for them.

### Tips

- The 58 OTHER `tip:` and `tip:a:b` matched down to recipient, amount and linked post (except the one below).
- Separately, there are 4 **CAWs with recipients and amounts**, which node2 turned into `Tip` rows per recipient (one has two recipients, so 2 rows; 5 rows in total). They are linked to the CAW itself. caw-reader was changed to count this form too.
- One is linked differently (tokenId 3, cawonce 145, body `tip:17:15`). caw-reader links it to post 17:15; node2 has no link (`cawId` is NULL). Post 17:15 is at block 46,183,534; this tip is at block 46,226,708.

### Votes

- node2's `Vote` has one row per account x poll. Which vote it keeps matches none of "first vote", "last vote" or "the validator that sent it". Example: tokenId 3 voted 7 times on poll 3:75, and node2 kept the 5th (cawonce 88).
- In node2, `Poll.endsAt` for polls 3:5, 3:44, 3:54, 3:64, 3:69 and 3:75 was 2026-09-13. The on-chain votes for them are from 2026-08-26 to 09-12 (UTC). node2's `User` createdAt was 2026-09-12.
- caw-reader keeps the provisional rule of "the latest vote per account". How votes are counted (changing a vote, multiple choice, the time used for the deadline) is in neither the contracts nor this memo. Left as an item to check with upstream.
