// SPDX-License-Identifier: MIT
// Only reads and shows the local node's API. All bodies are inserted with textContent (never parsed as HTML).

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// UI text in English and Japanese. Chain data (names, bodies, type names, statuses) is shown as it is
const I18N = {
  en: {
    docTitle: 'CAW read-only node', readonly: 'read-only', views: 'Views', readingStatus: 'Reading status', counts: 'Counts',
    tabPosts: 'Posts', tabActions: 'All actions', tabStatus: 'Status',
    lagNote: 'blocks behind the head seen', next: 'Next block', head: 'Head seen', table: 'Statistics table', other: 'OTHER interpreted',
    accepted: 'Accepted actions', notAccepted: 'Not accepted', names: 'Names', batches: 'Batches', unresolved: 'Unresolved batches', review: 'Items for review',
    note1: 'Showing the local DB (built by reading the chain). Bodies are shown as plain text only; no links are made and no external images are loaded.',
    note2: 'Likes, RECAWs, tips and votes count only the forms checked in the spec memo section "OTHER actions and body conventions (observed in real data)". Likes and votes count the latest one per account, a provisional rule (votes do not match node2).',
    newest: 'Newest first', more: 'Load older',
    titlePosts: 'Latest posts', titleActions: 'All actions', titleStatus: 'Items for review',
    loading: 'Loading', lastPass: (d) => 'Last completed pass ' + d, notRead: 'Not read yet', noPass: 'No completed pass yet',
    tableLoaded: 'Loaded', tableNone: 'Unavailable (bodies stay as bytes)',
    lastErr: 'Last recorded interruption: ', loadErr: 'Failed to load: ',
    to: (w) => 'To ' + w, undecoded: (n) => 'Could not decode the body (' + n + ' bytes)',
    votes: (n) => n + ' vote(s)', otherVotes: 'Votes not matching an option: ', pollRule: 'Counting the latest vote per voter (provisional rule)',
    likes: (n) => n + ' like(s)', recaws: (n) => n + ' RECAW(s)', tips: (n, t) => 'Tips ' + n + ' / ' + t + ' CAW',
    hiddenCaw: 'target of hide:caw', hiddenRecaw: '[target of hide:recaw]',
    payment: ' · payment ', tip: (t) => ' · tip ' + t + ' CAW', bodyBytes: (n) => ' · body ' + n + ' bytes (not decoded)',
    noPosts: 'No posts yet', noActions: 'No actions yet', noReview: 'No items for review',
  },
  ja: {
    docTitle: 'CAW 読み取り専用ノード', readonly: '読み取り専用', views: '表示', readingStatus: '読み込みの状況', counts: '件数',
    tabPosts: '投稿', tabActions: 'すべての行動', tabStatus: '確認事項',
    lagNote: 'ブロック遅れ（最後に見たヘッドまで）', next: '次に読むブロック', head: '最後に見たヘッド', table: '統計表', other: 'OTHER の解釈',
    accepted: '受理された行動', notAccepted: '受理されなかった行動', names: '名前', batches: 'バッチ', unresolved: '未解決のバッチ', review: '確認が要る項目',
    note1: 'チェーンを読んで作ったローカルの DB を表示しています。本文はプレーンテキストとしてだけ表示し、リンクは作らず、外部の画像も読み込みません。',
    note2: 'いいね・RECAW・チップ・投票は、仕様メモの「OTHER actions and body conventions (observed in real data)」で確かめた形だけを数えています。いいねと投票はアカウントごとに最新の1件を数える暫定ルールです（投票は node2 と一致しません）。',
    newest: '新しい順', more: 'さらに古いものを読み込む',
    titlePosts: '最新の投稿', titleActions: 'すべての行動', titleStatus: '確認が要る項目',
    loading: '読み込み中', lastPass: (d) => '最後に一巡した時刻 ' + d, notRead: 'まだ読んでいません', noPass: 'まだ一巡していません',
    tableLoaded: '読み込み済み', tableNone: 'なし（本文はバイトのまま）',
    lastErr: '最後に記録された中断: ', loadErr: '読み込みに失敗しました: ',
    to: (w) => '宛先 ' + w, undecoded: (n) => '本文を解読できませんでした（' + n + ' バイト）',
    votes: (n) => n + ' 票', otherVotes: '選択肢に合わない票: ', pollRule: '投票者ごとに最新の1票を数えています（暫定ルール）',
    likes: (n) => 'いいね ' + n, recaws: (n) => 'RECAW ' + n, tips: (n, t) => 'チップ ' + n + ' 件 / ' + t + ' CAW',
    hiddenCaw: 'hide:caw の対象', hiddenRecaw: '[hide:recaw の対象]',
    payment: ' · 支払い ', tip: (t) => ' · チップ ' + t + ' CAW', bodyBytes: (n) => ' · 本文 ' + n + ' バイト（未解読）',
    noPosts: 'まだ投稿はありません', noActions: 'まだ行動はありません', noReview: '確認が要る項目はありません',
  },
};
const LOCALES = { en: 'en-US', ja: 'ja-JP' };
const TITLE_KEYS = { posts: 'titlePosts', actions: 'titleActions', status: 'titleStatus' };

// The choice is kept in this browser only. Storage can be unavailable, so failures fall back to the browser language
function savedLang() {
  try { const v = localStorage.getItem('caw-reader-lang'); if (v === 'en' || v === 'ja') return v; } catch { /* not available */ }
  return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
}
let lang = savedLang();
const T = () => I18N[lang];

let view = 'posts';
let before = null;

function avatarColor(id) {
  const h = (id * 2654435761) >>> 0;
  const hue = 30 + (h % 30);
  const light = 45 + ((h >>> 8) % 20);
  return 'linear-gradient(135deg, hsl(' + hue + ' 90% ' + (light + 10) + '%), hsl(' + (hue - 8) + ' 85% ' + (light - 8) + '%))';
}
function who(id, name) { return name ? '@' + name : '#' + id; }
function when(ts) { return ts ? new Date(ts * 1000).toLocaleString(LOCALES[lang]) : ''; }
function fmt(n) { return n == null ? '-' : Number(n).toLocaleString(LOCALES[lang]); }
function metaItem(label, value, title) {
  const d = el('div');
  const v = el('span', null, value);
  if (title) v.title = title;
  d.append(el('span', null, label), v);
  return d;
}

function renderPost(a) {
  const t = T();
  const art = el('article', 'post');
  const av = el('div', 'av', a.senderName ? a.senderName[0].toUpperCase() : '#');
  av.setAttribute('aria-hidden', 'true');
  av.style.background = avatarColor(a.senderId);
  const body = el('div', 'body');

  const hdr = el('div', 'hdr');
  const names = el('div');
  names.append(el('span', 'name', a.senderName || '#' + a.senderId), el('span', 'handle', who(a.senderId, a.senderName)));
  hdr.append(names, el('span', 'time', when(a.time)));
  body.append(hdr);

  if (a.receiverId) body.append(el('div', 'to', t.to(who(a.receiverId, a.receiverName))));
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
      const row = el('div', 'opt');
      row.append(el('span', null, o.label), el('b', null, t.votes(o.votes)));
      const bar = el('div', 'bar');
      const fill = el('div');
      fill.style.width = (total ? Math.round((o.votes / total) * 100) : 0) + '%';
      bar.append(fill);
      box.append(row, bar);
    }
    if (st.poll.otherVotes) box.append(el('div', 'sub', t.otherVotes + st.poll.otherVotes));
    box.append(el('div', 'sub', t.pollRule));
    body.append(box);
  }

  if (st) {
    const counts = el('div', 'counts');
    counts.append(el('span', null, t.likes(st.likes)), el('span', null, t.recaws(st.recaws)));
    if (st.tips) counts.append(el('span', null, t.tips(st.tips, st.tipTotal)));
    if (st.hidden) counts.append(el('span', 'st', t.hiddenCaw));
    body.append(counts);
  }

  const meta = el('div', 'meta');
  meta.append(metaItem('cawonce', String(a.cawonce)), metaItem('block', fmt(a.block)), metaItem('tx', a.tx.slice(0, 10) + '…', a.tx));
  body.append(meta);

  art.append(av, body);
  return art;
}

function renderAct(a) {
  const t = T();
  const row = el('div', 'act' + (a.status === 'accepted' ? '' : ' not'));
  row.append(el('span', 'who', who(a.senderId, a.senderName)), ' ' + a.typeName);
  if (a.receiverId) row.append(' -> ', el('span', 'who', who(a.receiverId, a.receiverName)));
  if (a.recipients.length) row.append(t.payment + a.recipients.map((r, i) => '#' + r + (a.amounts[i] != null ? ' ' + a.amounts[i] + ' CAW' : '')).join(', '));
  if (a.amounts.length === a.recipients.length + 1) row.append(t.tip(a.amounts[a.amounts.length - 1]));
  if (a.text != null && a.textKind !== 'empty') row.append(' · ' + a.text);
  else if (a.textKind === 'binary') row.append(t.bodyBytes((a.textHex.length - 2) / 2));
  if (a.status !== 'accepted') row.append(' ', el('span', 'st', '[' + a.status + ']'));
  if (a.hiddenRecaw) row.append(' ', el('span', 'st', t.hiddenRecaw));
  return row;
}

function renderAnomaly(x) {
  const row = el('div', 'anom');
  row.append(el('b', null, x.kind), '  block ' + (x.block_number ?? '-') + '  tx ' + (x.tx_hash ?? '-'), el('br'), x.detail);
  return row;
}

function setCount(id, n, tileId) {
  $(id).textContent = fmt(n);
  if (tileId) $(tileId).classList.toggle('ng', n > 0);
}

function showLoadError(msg) {
  $('loaderr').textContent = msg || '';
  $('loaderr').hidden = !msg;
}

// Puts the fixed texts of the page into the current language
function applyLang() {
  const t = T();
  document.documentElement.lang = lang;
  document.title = t.docTitle;
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t[e.dataset.i18n];
  for (const e of document.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', t[e.dataset.i18nAria]);
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  $('feedtitle').textContent = t[TITLE_KEYS[view]];
}

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function showStatus() {
  const t = T();
  const s = await api('/api/status');
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

async function load(reset) {
  const t = T();
  $('more').disabled = true;
  try {
    if (reset) { $('feed').textContent = ''; before = null; }
    showLoadError(null);
    await showStatus();
    if (view === 'status') {
      $('foot').hidden = true;
      const a = await api('/api/anomalies?limit=100');
      if (!a.items.length) $('feed').append(el('div', 'empty', t.noReview));
      for (const x of a.items) $('feed').append(renderAnomaly(x));
      return;
    }
    const path = (view === 'posts' ? '/api/posts' : '/api/actions') + '?limit=50' + (before != null ? '&before=' + before : '');
    const d = await api(path);
    if (reset) $('foot').hidden = !d.items.length;
    if (reset && !d.items.length) $('feed').append(el('div', 'empty', view === 'posts' ? t.noPosts : t.noActions));
    for (const a of d.items) $('feed').append(view === 'posts' ? renderPost(a) : renderAct(a));
    if (d.items.length) before = d.items[d.items.length - 1].seq;
    $('more').disabled = d.items.length < 50;
  } catch (e) {
    showLoadError(t.loadErr + e.message);
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    view = tab.dataset.view;
    for (const u of document.querySelectorAll('.tab')) u.setAttribute('aria-selected', String(u === tab));
    $('feedtitle').textContent = T()[TITLE_KEYS[view]];
    load(true);
  });
}
for (const b of document.querySelectorAll('.lang button')) {
  b.addEventListener('click', () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem('caw-reader-lang', lang); } catch { /* the choice lasts until the page is reloaded */ }
    applyLang();
    load(true);
  });
}
$('more').addEventListener('click', () => load(false));
applyLang();
load(true);
