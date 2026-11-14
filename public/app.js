// SPDX-License-Identifier: MIT
// Only reads and shows the local node's API. All bodies are inserted with textContent (never parsed as HTML).

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let view = 'posts';
let before = null;

function avatarColor(id) {
  const h = (id * 2654435761) >>> 0;
  const hue = 30 + (h % 30);
  const light = 45 + ((h >>> 8) % 20);
  return 'linear-gradient(135deg, hsl(' + hue + ' 90% ' + (light + 10) + '%), hsl(' + (hue - 8) + ' 85% ' + (light - 8) + '%))';
}
function who(id, name) { return name ? '@' + name : '#' + id; }
function when(ts) { return ts ? new Date(ts * 1000).toLocaleString() : ''; }

function renderPost(a) {
  const art = el('article', 'post');
  const av = el('div', 'av', a.senderName ? a.senderName[0].toUpperCase() : '#');
  av.style.background = avatarColor(a.senderId);
  const body = el('div', 'body');
  const hdr = el('div', 'hdr');
  hdr.append(el('span', 'name', a.senderName || '#' + a.senderId), el('span', 'handle', who(a.senderId, a.senderName)), el('span', 'time', '· ' + when(a.time)));
  body.append(hdr);
  if (a.receiverId) body.append(el('div', 'to', 'To ' + who(a.receiverId, a.receiverName)));
  if (a.text != null && a.textKind !== 'empty') body.append(el('div', 'text', a.text));
  else if (a.textKind === 'binary') { body.append(el('div', 'to', 'Could not decode the body (' + (a.textHex.length - 2) / 2 + ' bytes)')); body.append(el('div', 'hex', a.textHex)); }
  const st = a.stats;
  if (st && st.poll) {
    const box = el('div', 'poll');
    for (const o of st.poll.options) box.append(el('div', 'opt', o.label + ' - ' + o.votes + ' vote(s)'));
    if (st.poll.otherVotes) box.append(el('div', 'opt sub', 'Votes not matching an option: ' + st.poll.otherVotes));
    box.append(el('div', 'opt sub', 'Counting the latest vote per voter (provisional rule)'));
    body.append(box);
  }
  const foot = el('div', 'foot');
  if (st) {
    foot.append(el('span', null, '♥ ' + st.likes), el('span', null, '🔁 ' + st.recaws));
    if (st.tips) foot.append(el('span', null, 'Tips ' + st.tips + ' / ' + st.tipTotal + ' CAW'));
    if (st.hidden) foot.append(el('span', 'st', 'target of hide:caw'));
  }
  foot.append(el('span', null, 'cawonce ' + a.cawonce), el('span', null, 'block ' + a.block), el('span', null, a.tx.slice(0, 10) + '...'));
  body.append(foot);
  art.append(av, body);
  return art;
}

function renderAct(a) {
  const row = el('div', 'act' + (a.status === 'accepted' ? '' : ' not'));
  const line = el('span');
  line.append(el('span', 'who', who(a.senderId, a.senderName)), ' ' + a.typeName);
  if (a.receiverId) line.append(' -> ', el('span', 'who', who(a.receiverId, a.receiverName)));
  if (a.recipients.length) line.append(' · payment ' + a.recipients.map((r, i) => '#' + r + (a.amounts[i] != null ? ' ' + a.amounts[i] + ' CAW' : '')).join(', '));
  if (a.amounts.length === a.recipients.length + 1) line.append(' · tip ' + a.amounts[a.amounts.length - 1] + ' CAW');
  if (a.text != null && a.textKind !== 'empty') line.append(' · ' + a.text);
  else if (a.textKind === 'binary') line.append(' · body ' + (a.textHex.length - 2) / 2 + ' bytes (not decoded)');
  if (a.status !== 'accepted') line.append(' ', el('span', 'st', '[' + a.status + ']'));
  if (a.hiddenRecaw) line.append(' ', el('span', 'st', '[target of hide:recaw]'));
  row.append(line);
  return row;
}

function setStatus(msg, ng) { $('status').textContent = msg; $('status').className = ng ? 'ng' : ''; }

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function showStatus() {
  const s = await api('/api/status');
  const lag = s.headSeen && s.nextBlock ? s.headSeen - s.nextBlock + 1 : null;
  setStatus((s.other_total !== s.other_parsed ? 'Interpreted OTHER actions ' + s.other_parsed + ' / ' + s.other_total + '\n' : '') + 'Next block to read ' + s.nextBlock + ' (head ' + s.headSeen + ', ' + lag + ' left)\n'
    + 'Accepted actions ' + s.accepted + ' / others ' + s.not_accepted + ' / names ' + s.users + '\n'
    + 'Unresolved batches ' + s.unresolved + ' / items for review ' + s.anomalies + '\n'
    + 'Body statistics table: ' + (s.bodyTable === 'loaded' ? 'loaded' : 'unavailable (bodies stay as bytes)')
    + (s.lastError ? '\nLast interruption: ' + s.lastError : ''), s.unresolved > 0 || s.anomalies > 0);
}

async function load(reset) {
  $('more').disabled = true;
  try {
    if (reset) { $('feed').textContent = ''; before = null; }
    await showStatus();
    if (view === 'status') {
      const a = await api('/api/anomalies?limit=100');
      const pre = el('pre', null, a.items.length ? a.items.map((x) => [x.kind, x.block_number ?? '-', x.tx_hash ?? '-', x.detail].join('  ')).join('\n') : 'No items for review');
      $('feed').append(pre);
      return;
    }
    const path = (view === 'posts' ? '/api/posts' : '/api/actions') + '?limit=50' + (before != null ? '&before=' + before : '');
    const d = await api(path);
    for (const a of d.items) $('feed').append(view === 'posts' ? renderPost(a) : renderAct(a));
    if (d.items.length) before = d.items[d.items.length - 1].seq;
    $('more').disabled = d.items.length < 50;
  } catch (e) {
    setStatus('Failed to load: ' + e.message, true);
  }
}

for (const t of document.querySelectorAll('.tab')) {
  t.addEventListener('click', () => {
    view = t.dataset.view;
    for (const u of document.querySelectorAll('.tab')) u.setAttribute('aria-selected', String(u === t));
    load(true);
  });
}
$('more').addEventListener('click', () => load(false));
load(true);
