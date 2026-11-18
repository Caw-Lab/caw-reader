// SPDX-License-Identifier: MIT
// Only reads and shows the local node's API. All bodies are inserted with textContent (never parsed as HTML).

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const link = (href, cls, text) => { const a = el('a', cls, text); a.href = href; return a; };

// UI text in English and Japanese. Chain data (names, bodies, type names, statuses) is shown as it is
const I18N = {
  en: {
    docTitle: 'CAW read-only node', readonly: 'read-only', views: 'Views', readingStatus: 'Reading status', counts: 'Counts',
    tabPosts: 'Posts', tabActions: 'All actions', tabStats: 'Stats', tabSearch: 'Search', tabStatus: 'Status',
    searchLabel: 'Search users', searchPh: '@name or #id', searchBtn: 'Search', searchHint: 'Find an account by the start of its name (with or without @) or by its number (#13).', titleSearchPage: 'Search accounts',
    receiptOpen: 'Receipt ▾', receiptClose: 'Close receipt ▴', receiptPerma: 'Link to this receipt', receiptLoading: 'Loading the receipt…',
    lagNote: 'blocks behind the head seen', next: 'Next block', head: 'Head seen', table: 'Statistics table', other: 'OTHER interpreted',
    accepted: 'Accepted actions', notAccepted: 'Not accepted', names: 'Names', batches: 'Batches', unresolved: 'Unresolved batches', review: 'Items for review',
    note1: 'Showing the local DB (built by reading the chain). Bodies are shown as plain text only; no links are made and no external images are loaded.',
    note2: 'Likes, RECAWs, tips and votes count only the forms checked in the spec memo section "OTHER actions and body conventions (observed in real data)". Likes and votes count the latest one per account, a provisional rule (votes do not match node2).',
    newest: 'Newest first', more: 'Load older', back: '← Latest posts',
    titlePosts: 'Latest posts', titleActions: 'All actions', titleStatus: 'Items for review', titleStats: 'Statistics',
    titleReceipt: 'On-chain receipt', titleUser: 'Account', titleSearch: (q) => 'Search: ' + q,
    loading: 'Loading', lastPass: (d) => 'Last completed pass ' + d, notRead: 'Not read yet', noPass: 'No completed pass yet',
    tableLoaded: 'Loaded', tableNone: 'Unavailable (bodies stay as bytes)',
    lastErr: 'Last recorded interruption: ', loadErr: 'Failed to load: ', notFound: 'Not found in this node\'s DB.',
    to: () => 'To ', undecoded: (n) => 'Could not decode the body (' + n + ' bytes)',
    votes: (n) => n + ' vote(s)', otherVotes: 'Votes not matching an option: ', pollRule: 'Counting the latest vote per voter (provisional rule)',
    likes: (n) => n + ' like(s)', recaws: (n) => n + ' RECAW(s)', tips: (n, t) => 'Tips ' + n + ' / ' + t + ' CAW',
    hiddenCaw: 'target of hide:caw', hiddenRecaw: '[target of hide:recaw]', 
    payment: ' · payment ', tip: (t) => ' · tip ' + t + ' CAW', bodyBytes: (n) => ' · body ' + n + ' bytes (not decoded)',
    noPosts: 'No posts yet', noActions: 'No actions yet', noReview: 'No items for review', noUsers: 'No matching accounts',
    recRecord: 'Where this post is on the chain', recChain: 'Chain', recContract: 'Contract', recBlock: 'Block', recTime: 'Block time',
    recTx: 'Transaction', recExplorer: 'Open in block explorer', recLog: 'Event log index', recPath: 'Signature path',
    recPathSig: 'Signed actions (sig)', recPathZk: 'Zero-knowledge batch (zk)', recValidator: 'Validator ID',
    recBatch: 'Position in the batch', recBatchPos: (i, n) => 'Action ' + i + ' of ' + n, recHash: 'Batch hash',
    recHashNote: 'keccak256 of the packed actions in the calldata', recBody: 'Body on the chain',
    recBodyBytes: (n, k) => n + ' bytes, ' + (k === 'binary' ? 'could not be decoded' : 'decoded as text'),
    recRaw: 'Show the body bytes', recUnresolved: 'The batch bytes were not found in the calldata (unresolved).',
    recCheck: 'How to check this yourself',
    recStep1: (tx) => 'Fetch transaction ' + tx + ' from any RPC of this chain (no CAW node is needed).',
    recStep2: (n) => 'In that transaction, the CawActions contract emitted an event (log index ' + n + ') holding the batch hash above. Find the bytes in the calldata whose keccak256 equals it.',
    recStep3: (i) => 'Read action ' + i + ' of that batch: sender, cawonce and the body bytes. The body is compressed with smltxt; caw-reader decodes it with the upstream statistics table after checking its SHA-256.',
    recRelated: 'Actions on this post', recNone: 'None recorded in this node\'s DB.',
    kinds: { like: 'LIKE', unlike: 'UNLIKE', recaw: 'RECAW', tip: 'TIP', vote: 'VOTE', hide_caw: 'HIDE' },
    voteFor: (v) => 'option ' + v, tipAmount: (v) => v + ' CAW',
    userPosts: 'Posts', userFollowers: 'Followers', userFollowing: 'Following', userL1: 'Name on L1', userMinted: 'Minted in block',
    userProfile: 'Profile field (p:)', userProfileTips: (n, t) => n + ' / ' + t + ' CAW', userTipsLabel: 'Profile tips', userPostsTitle: 'Posts by this account',
    statsDays: (n) => 'Last ' + n + ' days', statsPosts: 'Posts', statsActions: 'Accepted actions', statsNot: 'Not accepted',
    statsActive: 'Most active accounts in a day', statsTips: 'Tips', statsChart: 'Posts per day', statsDay: 'Day (UTC)',
    statsActiveCol: 'Active accounts', statsTipsCol: 'Tips (count / CAW)', statsByType: 'Actions by type',
    statsType: 'Type', statsStatus: 'Status', statsCount: 'Count',
    statsNote: 'Days are in UTC. Counts come from this node\'s DB, so days before the block it started reading from are missing. "Active accounts" are accounts with at least one accepted action that day.',
    statsEmpty: 'No actions in this period.',
    tabAuthority: 'Authority', tabSign: 'Signatures', titleAuthority: 'Who holds admin powers', titleSign: 'Check a signing request',
    auth: {
      lead: 'Who currently holds each admin-only power in the CAW contracts, read from the chain by this caw-reader\'s server (L1 and L2 RPC, no CAW node). Starting from CawProfile (L1) and CawActions (L2), every other contract is found by following values on the chain.',
      lead2: '"What it can do" is taken from GilgameshCaw/Caw solidity/contracts (MIT, master 97cd13f), with the file and lines. It makes no judgement of good or bad.',
      readAt: (b1, b2, d) => 'Values as of L1 block ' + b1 + ' and L2 block ' + b2 + ' (read ' + d + '; one reading is shared for up to 10 minutes).',
      stale: 'The chain could not be read just now; showing the last reading.', failed: 'The chain could not be read. Try again later.', notConfigured: 'This caw-reader has no L1 RPC or CawProfile address in its config, so this view is off.',
      l1: 'L1 (Ethereum)', l2: 'L2 (Base)', address: 'Address', foundVia: 'Found via',
      via: { seed: 'starting address in the config', 'cawProfile.owner': 'CawProfile.owner()', 'cawProfile.networkManager': 'CawProfile.networkManager()',
        'cawActions.cawProfile': 'CawActions.cawProfile()', 'ledger.lzDelegate': 'delegates(CawProfileLedger) on the LayerZero endpoint', 'cawActions.capOracle': 'CawActions.capOracle()' },
      names: { cawProfile: 'CawProfile (username NFTs)', pathwayExpanderL1: 'PathwayExpander (L1)', networkManager: 'CawNetworkManager (networks)',
        cawActions: 'CawActions (posts and other actions)', cawProfileLedger: 'CawProfileLedger (L2 balances and sessions)', pathwayExpanderL2: 'PathwayExpander (L2)', capOracle: 'CawCapOracle (cost cap)' },
      roles: { owner: 'owner', lzDelegate: 'LayerZero delegate', l2Writer: 'l2Writer' }, netOwner: (id) => 'Owner of network #' + id,
      kinds: { eoa: 'Plain wallet (one key)', contract: 'Contract', none: 'None (zero address)', error: 'Could not read' },
      sameAs: (n) => 'Same address as ' + n, minter: (a, same) => 'CawProfileMinter.pathwayExpander() is ' + a + (same ? ' (the same)' : ' (different)'),
      networks: (n) => 'Registered networks: ' + n + ' (nextNetworkId − 1)', truncated: (n) => 'Only the first ' + n + ' networks are read.',
      locks: (f, o) => 'Fees locked: ' + (f == null ? '?' : f ? 'yes' : 'no') + ' · ownership locked: ' + (o == null ? '?' : o ? 'yes' : 'no'),
      can: {
        'cawProfile.owner': ['Set a peer for a chain, once per chain; an existing peer cannot be changed (OnlyOnce). Ownership is handed to PathwayExpander in the constructor.', 'CawProfile.sol:224-241'],
        'cawProfileLedger.owner': ['renounceOwnership() is called in the constructor (comment: "Zero admin from here on"). A zero address means it was renounced.', 'CawProfileLedger.sol:275, 294-295'],
        lzDelegate: ['Can change this contract\'s settings on the LayerZero endpoint (DVNs, executor and similar). The source comment says this cannot forge messages themselves.', 'CawActionsArchive.sol:228-240'],
        'pathwayExpander.owner': ['Add peers for new chains (addPeer / addPeers), add DVN settings for new pathways (configureNewPathway / addDvnToPathway), add KYC verifiers (addKycVerifier). The comment says existing settings cannot be rewritten; after renounceOwnership nothing more can be added.', 'PathwayExpander.sol:32-71, 138-264'],
        network: ['Change fees and the fee address, add or remove sponsors, raise gas overrides (increase only), set the tip target, lower ceilings, change the owner. After lockNetworkFees / lockNetworkOwnership those parts can no longer be changed.', 'CawNetworkManager.sol:259-276, 418-683'],
        'capOracle.l2Writer': ['Writes the values used to compute the cost cap.', 'CawCapOracle.sol:127, 160'],
        cawActions: ['CawActions has no owner. Its references (CawProfileLedger, the ERC1271 sibling, CawCapOracle) are fixed at construction (immutable).', 'CawActions.sol:49, 167-179'],
      },
      notRead: 'CawActionsArchive and CawChallengeRelay are not read yet: no way to reach them from the two starting addresses has been found.',
    },
  },
  ja: {
    docTitle: 'CAW 読み取り専用ノード', readonly: '読み取り専用', views: '表示', readingStatus: '読み込みの状況', counts: '件数',
    tabPosts: '投稿', tabActions: 'すべての行動', tabStats: '統計', tabSearch: '検索', tabStatus: '確認事項',
    searchLabel: 'アカウントを検索', searchPh: '@名前 か #番号', searchBtn: '検索', searchHint: '名前の先頭（@ は付けても付けなくても）か、番号（#13 など）でアカウントを探せます。', titleSearchPage: 'アカウントを探す',
    receiptOpen: '受領書 ▾', receiptClose: '受領書を閉じる ▴', receiptPerma: 'この受領書へのリンク', receiptLoading: '受領書を読み込み中…',
    lagNote: 'ブロック遅れ（最後に見たヘッドまで）', next: '次に読むブロック', head: '最後に見たヘッド', table: '統計表', other: 'OTHER の解釈',
    accepted: '受理された行動', notAccepted: '受理されなかった行動', names: '名前', batches: 'バッチ', unresolved: '未解決のバッチ', review: '確認が要る項目',
    note1: 'チェーンを読んで作ったローカルの DB を表示しています。本文はプレーンテキストとしてだけ表示し、リンクは作らず、外部の画像も読み込みません。',
    note2: 'いいね・RECAW・チップ・投票は、仕様メモの「OTHER actions and body conventions (observed in real data)」で確かめた形だけを数えています。いいねと投票はアカウントごとに最新の1件を数える暫定ルールです（投票は node2 と一致しません）。',
    newest: '新しい順', more: 'さらに古いものを読み込む', back: '← 最新の投稿',
    titlePosts: '最新の投稿', titleActions: 'すべての行動', titleStatus: '確認が要る項目', titleStats: '統計',
    titleReceipt: 'チェーン上の受領書', titleUser: 'アカウント', titleSearch: (q) => '検索: ' + q,
    loading: '読み込み中', lastPass: (d) => '最後に一巡した時刻 ' + d, notRead: 'まだ読んでいません', noPass: 'まだ一巡していません',
    tableLoaded: '読み込み済み', tableNone: 'なし（本文はバイトのまま）',
    lastErr: '最後に記録された中断: ', loadErr: '読み込みに失敗しました: ', notFound: 'このノードの DB には見つかりません。',
    to: () => '宛先 ', undecoded: (n) => '本文を解読できませんでした（' + n + ' バイト）',
    votes: (n) => n + ' 票', otherVotes: '選択肢に合わない票: ', pollRule: '投票者ごとに最新の1票を数えています（暫定ルール）',
    likes: (n) => 'いいね ' + n, recaws: (n) => 'RECAW ' + n, tips: (n, t) => 'チップ ' + n + ' 件 / ' + t + ' CAW',
    hiddenCaw: 'hide:caw の対象', hiddenRecaw: '[hide:recaw の対象]', 
    payment: ' · 支払い ', tip: (t) => ' · チップ ' + t + ' CAW', bodyBytes: (n) => ' · 本文 ' + n + ' バイト（未解読）',
    noPosts: 'まだ投稿はありません', noActions: 'まだ行動はありません', noReview: '確認が要る項目はありません', noUsers: '当てはまるアカウントはありません',
    recRecord: 'この投稿がチェーンのどこにあるか', recChain: 'チェーン', recContract: 'コントラクト', recBlock: 'ブロック', recTime: 'ブロックの時刻',
    recTx: 'トランザクション', recExplorer: 'ブロックエクスプローラーで開く', recLog: 'イベントのログ番号', recPath: '署名の経路',
    recPathSig: '署名つきの行動（sig）', recPathZk: 'ゼロ知識証明のバッチ（zk）', recValidator: 'バリデータ ID',
    recBatch: 'バッチの中の位置', recBatchPos: (i, n) => n + ' 件中 ' + i + ' 件目', recHash: 'バッチのハッシュ',
    recHashNote: 'calldata の中の packedActions の keccak256', recBody: 'チェーン上の本文',
    recBodyBytes: (n, k) => n + ' バイト、' + (k === 'binary' ? '解読できませんでした' : 'テキストとして解読'),
    recRaw: '本文のバイトを表示', recUnresolved: 'このバッチのバイトは calldata の中に見つかっていません（未解決）。',
    recCheck: '自分で確かめる方法',
    recStep1: (tx) => 'このチェーンの好きな RPC から、トランザクション ' + tx + ' を取得します（CAW のノードは要りません）。',
    recStep2: (n) => 'そのトランザクションの中で、CawActions コントラクトが上のバッチのハッシュを含むイベント（ログ番号 ' + n + '）を出しています。calldata の中から、keccak256 がこれと一致するバイト列を探します。',
    recStep3: (i) => 'そのバッチの ' + i + ' 件目の行動を読みます（送信者・cawonce・本文のバイト）。本文は smltxt で圧縮されていて、caw-reader は SHA-256 を照合した上流の統計表で解読しています。',
    recRelated: 'この投稿への行動', recNone: 'このノードの DB には記録がありません。',
    kinds: { like: 'いいね', unlike: 'いいね取消', recaw: 'RECAW', tip: 'チップ', vote: '投票', hide_caw: '非表示' },
    voteFor: (v) => '選択肢 ' + v, tipAmount: (v) => v + ' CAW',
    userPosts: '投稿', userFollowers: 'フォロワー', userFollowing: 'フォロー中', userL1: 'L1 での名前', userMinted: 'ミントしたブロック',
    userProfile: 'プロフィール欄（p:）', userProfileTips: (n, t) => n + ' 件 / ' + t + ' CAW', userTipsLabel: 'プロフィールへのチップ', userPostsTitle: 'このアカウントの投稿',
    statsDays: (n) => '直近 ' + n + ' 日', statsPosts: '投稿', statsActions: '受理された行動', statsNot: '受理されなかった行動',
    statsActive: '1日に動いたアカウントの最多', statsTips: 'チップ', statsChart: '日ごとの投稿数', statsDay: '日付（UTC）',
    statsActiveCol: '動いたアカウント', statsTipsCol: 'チップ（件 / CAW）', statsByType: '種類ごとの行動',
    statsType: '種類', statsStatus: '状態', statsCount: '件数',
    statsNote: '日付は UTC です。このノードの DB から数えているので、読み始めたブロックより前の日は含まれません。「動いたアカウント」は、その日に受理された行動が1件以上あるアカウントです。',
    statsEmpty: 'この期間の行動はありません。',
    tabAuthority: '権限', tabSign: '署名の確認', titleAuthority: '管理者の権限を持っている人', titleSign: '署名の依頼を読み下す',
    auth: {
      lead: 'CAW のコントラクトで管理者だけができる操作の権限を、いま誰が持っているかを、この caw-reader のサーバーがチェーンから直接読んで並べます（L1 と L2 の RPC。CAW のノードは使いません）。起点は CawProfile（L1）と CawActions（L2）だけで、ほかのコントラクトはチェーン上の値をたどって見つけます。',
      lead2: '「できること」は GilgameshCaw/Caw の solidity/contracts（MIT、master 97cd13f）に書かれている内容で、ファイルと行を添えています。良い・悪いの判断はしません。',
      readAt: (b1, b2, d) => 'L1 ブロック ' + b1 + '、L2 ブロック ' + b2 + ' の時点の値です（' + d + ' に読みました。1回読んだ結果を最大10分、みんなで共有します）。',
      stale: 'いまはチェーンを読めなかったので、前回読んだ結果を表示しています。', failed: 'チェーンを読めませんでした。時間をおいて試してください。', notConfigured: 'この caw-reader の設定に L1 の RPC か CawProfile のアドレスがないため、この表示は使えません。',
      l1: 'L1（Ethereum）', l2: 'L2（Base）', address: 'アドレス', foundVia: '見つけ方',
      via: { seed: '設定の起点のアドレス', 'cawProfile.owner': 'CawProfile.owner() の値', 'cawProfile.networkManager': 'CawProfile.networkManager() の値',
        'cawActions.cawProfile': 'CawActions.cawProfile() の値', 'ledger.lzDelegate': 'LayerZero エンドポイントの delegates(CawProfileLedger) の値', 'cawActions.capOracle': 'CawActions.capOracle() の値' },
      names: { cawProfile: 'CawProfile（名前の NFT）', pathwayExpanderL1: 'PathwayExpander（L1）', networkManager: 'CawNetworkManager（ネットワークの登録簿）',
        cawActions: 'CawActions（投稿などの処理）', cawProfileLedger: 'CawProfileLedger（L2 の残高とセッション）', pathwayExpanderL2: 'PathwayExpander（L2）', capOracle: 'CawCapOracle（費用の上限）' },
      roles: { owner: 'owner（持ち主）', lzDelegate: 'LayerZero の delegate', l2Writer: 'l2Writer（値を書き込む係）' }, netOwner: (id) => 'ネットワーク #' + id + ' の持ち主',
      kinds: { eoa: 'ふつうのウォレット（鍵1本）', contract: 'コントラクト', none: 'なし（ゼロアドレス）', error: '読めませんでした' },
      sameAs: (n) => n + ' と同じアドレス', minter: (a, same) => 'CawProfileMinter.pathwayExpander() の値は ' + a + (same ? '（同じ）' : '（違う）'),
      networks: (n) => '登録されているネットワーク：' + n + ' 件（nextNetworkId − 1）', truncated: (n) => '最初の ' + n + ' 件だけを読んでいます。',
      locks: (f, o) => '手数料のロック：' + (f == null ? '?' : f ? '済み' : 'まだ') + '・持ち主のロック：' + (o == null ? '?' : o ? '済み' : 'まだ'),
      can: {
        'cawProfile.owner': ['チェーンごとのつなぎ先（peer）の設定。1つのチェーンにつき1回だけで、既にあるものは書き換えられない（OnlyOnce）。持ち主は作られた時点で PathwayExpander に渡される。', 'CawProfile.sol:224-241'],
        'cawProfileLedger.owner': ['作られた時点で renounceOwnership() が呼ばれる（コメント「Zero admin from here on」）。ゼロアドレスなら放棄済み。', 'CawProfileLedger.sol:275, 294-295'],
        lzDelegate: ['LayerZero のエンドポイント側の、このコントラクトの設定（DVN や送り手の設定など）を変えられる役。メッセージそのものは偽造できない、とソースのコメントにある。', 'CawActionsArchive.sol:228-240'],
        'pathwayExpander.owner': ['新しいチェーンのつなぎ先を足す（addPeer / addPeers）、新しい経路の DVN 設定を足す（configureNewPathway / addDvnToPathway）、KYC の検証役を足す（addKycVerifier）。既にある設定は書き換えられない、とコメントにある。renounceOwnership で放棄すると、以後は何も足せない。', 'PathwayExpander.sol:32-71, 138-264'],
        network: ['手数料と受け取り先の変更、スポンサーの追加・削除、ガスの上乗せ（増やす方向のみ）、チップの目標値、上限の引き下げ、持ち主の変更。lockNetworkFees / lockNetworkOwnership をすると、その分は以後変えられない。', 'CawNetworkManager.sol:259-276, 418-683'],
        'capOracle.l2Writer': ['費用の上限の計算に使う値を書き込む役。', 'CawCapOracle.sol:127, 160'],
        cawActions: ['CawActions には owner がない。参照先（CawProfileLedger、ERC1271 の相方、CawCapOracle）は作られた時点で固定（immutable）。', 'CawActions.sol:49, 167-179'],
      },
      notRead: 'CawActionsArchive と CawChallengeRelay は、起点の2つからたどる方法がまだ見つかっていないため、まだ読んでいません。',
    },
  },
};
const LOCALES = { en: 'en-US', ja: 'ja-JP' };
const CHAINS = { 84532: { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org/tx/' }, 8453: { name: 'Base', explorer: 'https://basescan.org/tx/' } };

// The choice is kept in this browser only. Storage can be unavailable, so failures fall back to the browser language
function savedLang() {
  try { const v = localStorage.getItem('caw-reader-lang'); if (v === 'en' || v === 'ja') return v; } catch { /* not available */ }
  return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
}
let lang = savedLang();
const T = () => I18N[lang];

let status = null;          // the last /api/status
let more = null;            // loads the next page of the current list, or null
let statsDays = 30;

function avatarColor(id) {
  const h = (id * 2654435761) >>> 0;
  const hue = 30 + (h % 30);
  const light = 45 + ((h >>> 8) % 20);
  return 'linear-gradient(135deg, hsl(' + hue + ' 90% ' + (light + 10) + '%), hsl(' + (hue - 8) + ' 85% ' + (light - 8) + '%))';
}
function avatar(id, name) {
  const av = el('div', 'av', name ? name[0].toUpperCase() : '#');
  av.setAttribute('aria-hidden', 'true');
  av.style.background = avatarColor(id);
  return av;
}
function who(id, name) { return name ? '@' + name : '#' + id; }
function whoLink(id, name, cls) { return link('#/user/' + id, cls, who(id, name)); }
function when(ts) { return ts ? new Date(ts * 1000).toLocaleString(LOCALES[lang]) : ''; }
function fmt(n) { return n == null ? '-' : Number(n).toLocaleString(LOCALES[lang]); }
function metaItem(label, value, title) {
  const d = el('div');
  const v = el('span', null, value);
  if (title) v.title = title;
  d.append(el('span', null, label), v);
  return d;
}
function row(dl, label, ...values) {
  const dd = el('dd');
  dd.append(...values);
  dl.append(el('dt', null, label), dd);
}

function renderPost(a, { open = false } = {}) {
  const t = T();
  const art = el('article', 'post');
  const body = el('div', 'body');

  const hdr = el('div', 'hdr');
  const names = el('div');
  const nm = el('span', 'name'); nm.append(link('#/user/' + a.senderId, null, a.senderName || '#' + a.senderId));
  names.append(nm, el('span', 'handle', who(a.senderId, a.senderName)));
  hdr.append(names, el('span', 'time', when(a.time)));
  body.append(hdr);

  if (a.receiverId) { const to = el('div', 'to', t.to()); to.append(whoLink(a.receiverId, a.receiverName)); body.append(to); }
  if (a.text != null && a.textKind !== 'empty') body.append(el('p', 'text', a.text));
  else if (a.textKind === 'binary') {
    body.append(el('div', 'to', t.undecoded((a.textHex.length - 2) / 2)));
    body.append(el('code', 'raw', a.textHex));
  }

  const st = a.stats;
  if (st && st.poll) {
    const box = el('div', 'poll');
    const total = st.poll.options.reduce((s, o) => s + o.votes, 0);
    for (const o of st.poll.options) {
      const r = el('div', 'opt');
      r.append(el('span', null, o.label), el('b', null, t.votes(o.votes)));
      const bar = el('div', 'bar');
      const fill = el('div');
      fill.style.width = (total ? Math.round((o.votes / total) * 100) : 0) + '%';
      bar.append(fill);
      box.append(r, bar);
    }
    if (st.poll.otherVotes) box.append(el('div', 'sub', t.otherVotes + st.poll.otherVotes));
    box.append(el('div', 'sub', t.pollRule));
    body.append(box);
  }

  const counts = el('div', 'counts');
  if (st) {
    counts.append(el('span', null, t.likes(st.likes)), el('span', null, t.recaws(st.recaws)));
    if (st.tips) counts.append(el('span', null, t.tips(st.tips, st.tipTotal)));
    if (st.hidden) counts.append(el('span', 'st', t.hiddenCaw));
  }
  body.append(counts);

  const meta = el('div', 'meta');
  meta.append(metaItem('cawonce', String(a.cawonce)), metaItem('block', fmt(a.block)), metaItem('tx', a.tx.slice(0, 10) + '…', a.tx));
  body.append(meta);

  // The receipt is folded inside the card, so the place in the list is kept. It is fetched on first open
  const btn = el('button', 'rbtn', t.receiptOpen);
  btn.type = 'button';
  const box = el('div', 'receipt');
  box.id = 'r-' + a.senderId + '-' + a.cawonce;
  box.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', box.id);
  let loaded = false;
  const toggle = async () => {
    const show = box.hidden;
    box.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    btn.textContent = show ? T().receiptClose : T().receiptOpen;
    if (!show || loaded) return;
    loaded = true;
    box.textContent = '';
    box.append(el('p', 'mut', T().receiptLoading));
    try {
      const d = await api('/api/posts/' + a.senderId + '/' + a.cawonce);
      box.textContent = '';
      if (!d) { box.append(el('p', 'mut', T().notFound)); return; }
      box.append(...renderReceipt({ ...d.post, receipt: d.receipt, related: d.related }));
    } catch (e) { loaded = false; box.textContent = ''; box.append(el('p', 'mut', T().loadErr + e.message)); }
  };
  btn.addEventListener('click', toggle);
  const bar = el('div'); bar.append(btn);
  body.append(bar, box);
  if (open) toggle();

  art.append(avatar(a.senderId, a.senderName), body);
  return art;
}

function renderAct(a) {
  const t = T();
  const r = el('div', 'act' + (a.status === 'accepted' ? '' : ' not'));
  r.append(whoLink(a.senderId, a.senderName, 'who'), ' ' + a.typeName);
  if (a.receiverId) r.append(' -> ', whoLink(a.receiverId, a.receiverName, 'who'));
  if (a.recipients.length) r.append(t.payment + a.recipients.map((x, i) => '#' + x + (a.amounts[i] != null ? ' ' + a.amounts[i] + ' CAW' : '')).join(', '));
  if (a.amounts.length === a.recipients.length + 1) r.append(t.tip(a.amounts[a.amounts.length - 1]));
  if (a.text != null && a.textKind !== 'empty') r.append(' · ' + a.text);
  else if (a.textKind === 'binary') r.append(t.bodyBytes((a.textHex.length - 2) / 2));
  if (a.status !== 'accepted') r.append(' ', el('span', 'st', '[' + a.status + ']'));
  if (a.hiddenRecaw) r.append(' ', el('span', 'st', t.hiddenRecaw));
  return r;
}

function renderAnomaly(x) {
  const r = el('div', 'anom');
  r.append(el('b', null, x.kind), '  block ' + (x.block_number ?? '-') + '  tx ' + (x.tx_hash ?? '-'), el('br'), x.detail);
  return r;
}

// ---------- pages ----------

function renderReceipt(p) {
  const t = T();
  const out = [];
  const chain = status?.chain ?? null;
  const info = chain ? CHAINS[chain.chainId] : null;
  const rc = p.receipt;

  const sec = el('div', 'part');
  sec.append(el('h3', null, t.recRecord));
  if (!rc.resolved) sec.append(el('div', 'err', t.recUnresolved));
  const dl = el('dl', 'rows');
  if (chain) row(dl, t.recChain, (info ? info.name + ' ' : '') + '(' + chain.chainId + ')');
  if (chain) row(dl, t.recContract, el('span', 'mono', rc.contract === 'erc1271' ? (chain.cawActionsErc1271 ?? 'CawActionsERC1271') : chain.cawActions));
  row(dl, t.recBlock, fmt(p.block));
  row(dl, t.recTime, el('span', null, when(p.time)), el('small', null, p.time ? new Date(p.time * 1000).toISOString().replace('.000Z', 'Z') : ''));
  const txv = [el('span', 'mono', p.tx)];
  if (info) { const a = link(info.explorer + p.tx, null, t.recExplorer); a.target = '_blank'; a.rel = 'noopener noreferrer'; const sm = el('small'); sm.append(a); txv.push(sm); }
  row(dl, t.recTx, ...txv);
  row(dl, t.recLog, String(rc.logIndex));
  row(dl, t.recPath, rc.kind === 'zk' ? t.recPathZk : t.recPathSig);
  row(dl, t.recValidator, String(rc.validatorId));
  row(dl, t.recBatch, t.recBatchPos(rc.indexInBatch + 1, rc.batchSize));
  row(dl, t.recHash, el('span', 'mono', rc.batchHash), el('small', null, t.recHashNote));
  const det = el('details'); det.append(el('summary', null, t.recRaw), el('code', 'raw', p.textHex));
  row(dl, t.recBody, el('span', null, t.recBodyBytes(rc.bodyBytes, p.textKind)), det);
  sec.append(dl);
  out.push(sec);

  // The steps are folded too; most readers only need the record above
  const how = el('details');
  how.append(el('summary', null, t.recCheck));
  const ol = el('ol', 'steps');
  ol.append(el('li', null, t.recStep1(p.tx)), el('li', null, t.recStep2(rc.logIndex)), el('li', null, t.recStep3(rc.indexInBatch + 1)));
  how.append(ol);
  out.push(how);

  const rel = el('div', 'part');
  rel.append(el('h3', null, t.recRelated));
  if (!p.related.length) rel.append(el('p', 'mut', t.recNone));
  for (const x of p.related) {
    const r = el('div', 'rel');
    r.append(el('span', 'kind', t.kinds[x.kind] ?? x.kind), whoLink(x.senderId, x.senderName));
    if (x.kind === 'vote') r.append(el('span', null, t.voteFor(x.value)));
    if (x.kind === 'tip') r.append(el('span', null, t.tipAmount(x.value)));
    const tx = el('span', 'mono', x.tx.slice(0, 10) + '…'); tx.title = x.tx;
    r.append(el('span', 'time', when(x.time)), tx);
    rel.append(r);
  }
  out.push(rel);
  out.push(link('#/post/' + p.senderId + '/' + p.cawonce, 'perma', t.receiptPerma + ' →'));
  return out;
}

function renderUser(u) {
  const t = T();
  const sec = el('section', 'sec');
  const head = el('div', 'prof');
  const names = el('div');
  names.append(el('h2', null, u.name || '#' + u.id), el('div', 'handle', who(u.id, u.name) + ' · #' + u.id));
  head.append(avatar(u.id, u.name), names);
  sec.append(head);
  const nums = el('div', 'stats3');
  for (const [label, n] of [[t.userPosts, u.posts], [t.userFollowers, u.followers], [t.userFollowing, u.following]]) {
    const d = el('div'); d.append(el('span', null, label), el('b', null, fmt(n))); nums.append(d);
  }
  sec.append(nums);
  const dl = el('dl', 'rows');
  if (u.l1Name && u.l1Name !== u.name) row(dl, t.userL1, u.l1Name);
  if (u.mintedBlock != null) row(dl, t.userMinted, fmt(u.mintedBlock));
  if (u.profileTips) row(dl, t.userTipsLabel, t.userProfileTips(u.profileTips, u.profileTipTotal));
  for (const [k, v] of Object.entries(u.fields ?? {})) row(dl, t.userProfile + ' ' + k, v);
  if (dl.childElementCount) sec.append(dl);
  return sec;
}

function renderStats(s) {
  const t = T();
  const out = [];
  const top = el('section', 'sec');
  const period = el('div', 'period');
  for (const d of [7, 30, 90]) {
    const b = el('button', null, t.statsDays(d));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(d === statsDays));
    b.addEventListener('click', () => { statsDays = d; render(); });
    period.append(b);
  }
  top.append(period);
  const sum = (k) => s.daily.reduce((n, r) => n + r[k], 0);
  const tipTotal = s.daily.reduce((n, r) => n + BigInt(r.tipTotal), 0n);
  const tiles = el('div', 'stats3');
  for (const [label, v] of [[t.statsPosts, fmt(sum('posts'))], [t.statsActions, fmt(sum('accepted'))], [t.statsNot, fmt(sum('notAccepted'))],
    [t.statsActive, fmt(Math.max(0, ...s.daily.map((r) => r.active)))], [t.statsTips, fmt(sum('tips')) + ' / ' + tipTotal.toLocaleString(LOCALES[lang]) + ' CAW']]) {
    const d = el('div'); d.append(el('span', null, label), el('b', null, v)); tiles.append(d);
  }
  top.append(tiles);
  out.push(top);

  if (!s.daily.length) { const e = el('section', 'sec'); e.append(el('p', null, t.statsEmpty)); out.push(e); return out; }

  const ch = el('section', 'sec');
  ch.append(el('h2', null, t.statsChart));
  const chart = el('div', 'chart');
  chart.setAttribute('role', 'img');
  // Days with no actions are not in the data; fill them with 0 from the first day with data to today (UTC)
  const byDay = new Map(s.daily.map((r) => [r.day, r]));
  const days = [];
  const first = Date.parse(s.daily[s.daily.length - 1].day + 'T00:00:00Z');
  for (let d = first; d <= Date.now(); d += 86400000) { const k = new Date(d).toISOString().slice(0, 10); days.push(byDay.get(k) ?? { day: k, posts: 0 }); }
  const max = Math.max(1, ...days.map((r) => r.posts));
  chart.setAttribute('aria-label', t.statsChart + ': ' + days.map((r) => r.day + ' ' + r.posts).join(', '));
  for (const r of days) { const b = el('div'); b.style.height = (r.posts ? Math.max(2, Math.round((r.posts / max) * 100)) : 0) + '%'; b.title = r.day + ': ' + r.posts; chart.append(b); }
  const axis = el('div', 'chartaxis'); axis.append(el('span', null, days[0].day), el('span', null, days[days.length - 1].day));
  ch.append(chart, axis);
  out.push(ch);

  const tb = el('section', 'sec');
  const wrap = el('div', 'tbl');
  const table = el('table');
  const thead = el('tr');
  for (const h of [t.statsDay, t.statsPosts, t.statsActions, t.statsNot, t.statsActiveCol, t.statsTipsCol]) thead.append(el('th', null, h));
  table.append(thead);
  for (const r of s.daily) {
    const tr = el('tr');
    for (const v of [r.day, fmt(r.posts), fmt(r.accepted), fmt(r.notAccepted), fmt(r.active), fmt(r.tips) + ' / ' + BigInt(r.tipTotal).toLocaleString(LOCALES[lang])]) tr.append(el('td', null, v));
    table.append(tr);
  }
  wrap.append(table); tb.append(wrap);
  out.push(tb);

  const bt = el('section', 'sec');
  bt.append(el('h2', null, t.statsByType));
  const w2 = el('div', 'tbl'); const t2 = el('table'); const h2 = el('tr');
  for (const h of [t.statsType, t.statsStatus, t.statsCount]) h2.append(el('th', null, h));
  t2.append(h2);
  for (const r of [...s.byType].sort((a, b) => a.type - b.type || a.status.localeCompare(b.status))) {
    const tr = el('tr'); for (const v of [r.typeName, r.status, fmt(r.count)]) tr.append(el('td', null, v)); t2.append(tr);
  }
  w2.append(t2); bt.append(w2, el('p', null, t.statsNote));
  out.push(bt);
  return out;
}

// ---------- authority ----------

function renderAuthority(d) {
  const t = T(); const A = t.auth;
  const head = el('section', 'sec');
  head.append(el('p', null, A.lead), el('p', null, A.lead2));
  if (!d || d.error) { head.append(el('div', 'err', d?.error === 'rpc_failed' ? A.failed : A.notConfigured)); return [head]; }
  head.append(el('p', null, A.readAt(fmt(d.l1Block), fmt(d.l2Block), new Date(d.readAt).toLocaleString(LOCALES[lang]))));
  if (d.stale) head.append(el('div', 'err', A.stale));
  const out = [head];
  const names = {};
  for (const c of d.contracts) names[c.address.toLowerCase()] = A.names[c.key] ?? c.key;
  const holderCell = (h, self) => {
    const dd = el('dd', 'grp');
    if (h.address) dd.append(el('div', 'mono', h.address));
    dd.append(el('span', 'htag ' + h.kind, A.kinds[h.kind] + (h.code ? ' (' + h.code + ')' : '')));
    const same = h.address && h.address.toLowerCase() !== self && names[h.address.toLowerCase()];
    if (same) dd.append(el('small', null, A.sameAs(same)));
    return dd;
  };
  const canRow = (dl, key) => {
    const [text, src] = A.can[key];
    dl.append(el('dt', null, '')); const dd = el('dd', 'note'); dd.append(el('span', 'can', text), el('small', 'mono', src)); dl.append(dd);
  };
  let last = null;
  for (const c of d.contracts) {
    if (c.chain !== last) { last = c.chain; const h = el('div', 'feedhead'); h.append(el('b', null, c.chain === 'l1' ? A.l1 : A.l2)); out.push(h); }
    const sec = el('section', 'sec auth');
    sec.append(el('h2', null, A.names[c.key] ?? c.key));
    const dl = el('dl', 'rows');
    dl.append(el('dt', null, A.address), el('dd', 'mono', c.address), el('dt', null, A.foundVia), el('dd', null, A.via[c.foundVia] ?? c.foundVia));
    if (c.minterCheck) dl.append(el('dt', null, ''), el('dd', null, A.minter(c.minterCheck.address, c.minterCheck.same)));
    const self = c.address.toLowerCase();
    for (const r of c.roles) {
      dl.append(el('dt', 'grp', A.roles[r.role] ?? r.role), holderCell(r.holder, self));
      const key = r.role === 'lzDelegate' ? 'lzDelegate' : c.key.startsWith('pathwayExpander') ? 'pathwayExpander.owner' : c.key + '.' + r.role;
      if (A.can[key]) canRow(dl, key);
    }
    if (c.key === 'cawActions') { dl.append(el('dt', 'grp', ''), el('dd', 'grp')); canRow(dl, 'cawActions'); }
    if (c.key === 'networkManager') {
      if (c.error) dl.append(el('dt', null, ''), el('dd', null, A.kinds.error + ' (' + c.error + ')'));
      if (c.networkCount != null) dl.append(el('dt', null, ''), el('dd', null, A.networks(fmt(c.networkCount))));
      for (const n of c.networks) {
        dl.append(el('dt', 'grp', A.netOwner(n.id)), holderCell(n.holder, self));
        dl.append(el('dt', null, ''), el('dd', null, A.locks(n.feesLocked, n.ownershipLocked)));
      }
      if (c.truncated) dl.append(el('dt', null, ''), el('dd', null, A.truncated(c.networks.length)));
      if (c.networks.length) { dl.append(el('dt', 'grp', ''), el('dd', 'grp')); canRow(dl, 'network'); }
    }
    sec.append(dl);
    out.push(sec);
  }
  const foot = el('section', 'sec'); foot.append(el('p', null, A.notRead));
  out.push(foot);
  return out;
}

// ---------- shell ----------

function setCount(id, n, tileId) {
  $(id).textContent = fmt(n);
  if (tileId) $(tileId).classList.toggle('ng', n > 0);
}

function showLoadError(msg) {
  $('loaderr').textContent = msg || '';
  $('loaderr').hidden = !msg;
}

function applyLang() {
  const t = T();
  document.documentElement.lang = lang;
  document.title = t.docTitle;
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t[e.dataset.i18n];
  for (const e of document.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', t[e.dataset.i18nAria]);
  for (const e of document.querySelectorAll('[data-i18n-ph]')) e.placeholder = t[e.dataset.i18nPh];
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

async function api(path) {
  const r = await fetch(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function showStatus() {
  const t = T();
  const s = await api('/api/status');
  status = s;
  const lag = s.headSeen != null && s.nextBlock != null ? s.headSeen - s.nextBlock + 1 : null;
  $('lag').textContent = fmt(lag);
  $('next').textContent = fmt(s.nextBlock);
  $('head').textContent = fmt(s.headSeen);
  $('table').textContent = s.bodyTable === 'loaded' ? t.tableLoaded : t.tableNone;
  $('other').textContent = fmt(s.other_parsed) + ' / ' + fmt(s.other_total);
  const state = $('state');
  if (s.lastOk) { state.textContent = t.lastPass(new Date(s.lastOk).toLocaleString(LOCALES[lang])); state.className = 'state'; }
  else if (s.nextBlock == null) { state.textContent = t.notRead; state.className = 'state idle'; }
  else { state.textContent = t.noPass; state.className = 'state idle'; }
  $('lasterr').textContent = s.lastError ? t.lastErr + s.lastError : '';
  $('lasterr').hidden = !s.lastError;
  setCount('c-accepted', s.accepted);
  setCount('c-not', s.not_accepted);
  setCount('c-users', s.users);
  setCount('c-batches', s.batches);
  setCount('c-unresolved', s.unresolved, 't-unresolved');
  setCount('c-anomalies', s.anomalies, 't-anomalies');
}

// Reads the hash: #/posts, #/actions, #/stats, #/review, #/authority, #/sign, #/post/<sender>/<cawonce>, #/user/<id>, #/search/<text>
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'posts';
  if (name === 'post' && /^\d{1,10}$/.test(parts[1] ?? '') && /^\d{1,10}$/.test(parts[2] ?? '')) return { name, sender: parts[1], cawonce: parts[2] };
  if (name === 'user' && /^\d{1,10}$/.test(parts[1] ?? '')) return { name, id: parts[1] };
  if (name === 'search') { let q = ''; try { q = decodeURIComponent(parts.slice(1).join('/')); } catch { /* broken escape */ } return { name, q: q.slice(0, 32) }; }
  if (['posts', 'actions', 'stats', 'review', 'authority', 'sign'].includes(name)) return { name };
  return { name: 'posts' };
}

function setHead(title, sub) {
  $('feedtitle').textContent = title;
  const s = $('feedsub'); s.textContent = '';
  if (sub) s.append(sub);
}

// A list that loads 50 at a time, newest first
function startList(path, renderItem, emptyText) {
  let before = null;
  more = async () => {
    $('more').disabled = true;
    const d = await api(path + '?limit=50' + (before != null ? '&before=' + before : ''));
    const items = d?.items ?? [];
    if (before == null && !items.length) $('feed').append(el('div', 'empty', emptyText));
    for (const a of items) $('feed').append(renderItem(a));
    if (items.length) before = items[items.length - 1].seq;
    $('foot').hidden = before == null;
    $('more').disabled = items.length < 50;
  };
  return more();
}

let renderId = 0;
async function render() {
  const t = T();
  const r = parseRoute();
  const id = ++renderId;
  document.body.dataset.route = r.name;   // the stylesheet shows the status panel by tab on narrow screens
  for (const a of document.querySelectorAll('a.tab')) {
    if (a.dataset.route === r.name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  $('feed').textContent = '';
  $('foot').hidden = true;
  more = null;
  showLoadError(null);
  try {
    await showStatus();
    if (id !== renderId) return;   // a newer page was opened meanwhile
    if (r.name === 'posts') { setHead(t.titlePosts, t.newest); await startList('/api/posts', renderPost, t.noPosts); }
    else if (r.name === 'actions') { setHead(t.titleActions, t.newest); await startList('/api/actions', renderAct, t.noActions); }
    else if (r.name === 'review') {
      setHead(t.titleStatus, t.newest);
      const a = await api('/api/anomalies?limit=100');
      if (!a.items.length) $('feed').append(el('div', 'empty', t.noReview));
      for (const x of a.items) $('feed').append(renderAnomaly(x));
    } else if (r.name === 'stats') {
      setHead(t.titleStats, null);
      const s = await api('/api/stats?days=' + statsDays);
      $('feed').append(...renderStats(s));
    } else if (r.name === 'authority') {
      setHead(t.titleAuthority, null);
      const d = await api('/api/authority');
      $('feed').append(...renderAuthority(d));
    } else if (r.name === 'sign') {
      setHead(t.titleSign, null);
      window.CawSign.render($('feed'), lang, status?.chain ?? null);
    } else if (r.name === 'post') {
      setHead(t.titleReceipt, link('#/posts', null, t.back));
      const d = await api('/api/posts/' + r.sender + '/' + r.cawonce);
      if (!d) { $('feed').append(el('div', 'empty', t.notFound)); return; }
      $('feed').append(renderPost(d.post, { open: true }));
    } else if (r.name === 'user') {
      setHead(t.titleUser, link('#/posts', null, t.back));
      const u = await api('/api/users/' + r.id);
      if (!u) { $('feed').append(el('div', 'empty', t.notFound)); return; }
      $('feed').append(renderUser(u));
      const h = el('div', 'feedhead'); h.append(el('b', null, t.userPostsTitle), el('span', null, t.newest));
      $('feed').append(h);
      await startList('/api/users/' + r.id + '/posts', renderPost, t.noPosts);
    } else if (r.name === 'search') {
      setHead(t.titleSearchPage, null);
      const form = el('form', 'search'); form.setAttribute('role', 'search');
      const input = el('input'); input.type = 'search'; input.maxLength = 32; input.autocomplete = 'off';
      input.placeholder = t.searchPh; input.setAttribute('aria-label', t.searchLabel); input.value = r.q;
      const go = el('button', null, t.searchBtn); go.type = 'submit';
      form.append(input, go);
      form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) location.hash = '#/search/' + encodeURIComponent(q); });
      $('feed').append(form);
      if (!r.q) { const h = el('div', 'empty', t.searchHint); $('feed').append(h); input.focus(); return; }
      const d = await api('/api/users?q=' + encodeURIComponent(r.q));
      const list = el('div', 'ulist');
      for (const u of d?.items ?? []) {
        const a = link('#/user/' + u.id, null, null);
        const nm = el('div'); nm.append(el('div', 'name', u.name || '#' + u.id), el('div', 'handle', who(u.id, u.name) + ' · #' + u.id));
        a.append(avatar(u.id, u.name), nm);
        list.append(a);
      }
      if (!list.childElementCount) list.append(el('div', 'empty', t.noUsers));
      $('feed').append(list);
    }
  } catch (e) {
    showLoadError(t.loadErr + e.message);
  }
}

for (const b of document.querySelectorAll('.lang button')) {
  b.addEventListener('click', () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem('caw-reader-lang', lang); } catch { /* the choice lasts until the page is reloaded */ }
    applyLang();
    render();
  });
}
$('more').addEventListener('click', () => { if (more) more().catch((e) => showLoadError(T().loadErr + e.message)); });
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
applyLang();
render();
