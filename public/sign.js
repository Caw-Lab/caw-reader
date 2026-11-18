// SPDX-License-Identifier: MIT
//
// "Signatures" tab: reads a signing request pasted by the user and says, following the CAW contract
// source (GilgameshCaw/Caw solidity/contracts, MIT, master 97cd13f), what signing it would do.
// Runs only in this browser: what is pasted is never sent anywhere, not even to this reader's server.
// The Quick Sign text rules (parseQuickSign) were compared with the compiled SessionMessageParser.sol
// on 24 messages; test/sign.test.mjs keeps those cases.
(() => {
"use strict";
const T = {
  ja: {
    title: "CAW Signature Decoder", badge: "試作版 / 通信なし",
    lead1: "ウォレットに出た署名の依頼を貼ると、それに署名すると何が起きるのかを、CAW のコントラクトのソースに沿って読み下します。",
    lead2: "貼った内容はこのブラウザの中だけで読み、この caw-reader のサーバーも含めて、どこにも送りません。署名そのものや秘密鍵は貼らないでください（必要ありません）。比べる相手のコントラクトは、この caw-reader が読んでいるもの（状態の欄のチェーンとアドレス）です。",
    ph: "eth_signTypedData_v4 の JSON（domain / types / primaryType / message）か、personal_sign の文章（または 0x で始まる16進）を貼ってください。",
    go: "読み下す", samples: "例：", sPost: "投稿", sSession: "クイックサイン（型付き）", sQs: "クイックサイン（文章）", sNoLimit: "「No limit」の文章",
    foot: "読み下しの根拠：GilgameshCaw/Caw solidity/contracts（MIT、master 97cd13f）。各項目の下に、そのことが書かれているファイルと行を出しています。このページは判断をしません。署名するかどうかは、読み下した内容を見て決めてください。",
    empty: "何も貼られていません。", unreadable: "読み取れませんでした。型付きデータの JSON か、文章を貼ってください。",
    kindTyped: (p) => `型付きデータ（EIP-712）・${p}`, kindPersonal: "文章への署名（personal_sign）",
    notCaw: "CAW のコントラクトが受け付ける形のどれにも当てはまりません。",
    domain: "署名の宛先", chain: "チェーン", contract: "コントラクト", dname: "名前 / 版",
    chainName: { 84532: "Base Sepolia（テストネット）", 8453: "Base（メインネット）", 11155111: "Ethereum Sepolia", 1: "Ethereum メインネット" },
    knownC: (n) => `この caw-reader が読んでいるコントラクトと同じアドレスです：${n}`,
    unknownC: "この caw-reader が読んでいるコントラクトのアドレスではありません。CAW の公式のアドレスかどうかは、別の手段（ノードポータルの整合性チェックなど）で確かめてください。",
    otherChain: "Base / Base Sepolia 以外のチェーンです。CAW のこの種類の署名は L2（Base 系）のコントラクト宛てです。",
    nameMismatch: (got, exp) => `domain の名前が「${got}」です。この種類の署名でコントラクトが使う名前は「${exp}」で、一致しないとコントラクトは署名を受け付けません。`,
    typeMismatch: (exp) => `型の定義がコントラクトのものと一致しません。コントラクトの定義：${exp}`,
    typeOk: "型の定義はコントラクトのものと一字一句一致しています。",
    actionNames: ["CAW（投稿）", "LIKE（いいね）", "UNLIKE（いいね取り消し）", "RECAW（リキャウ）", "FOLLOW（フォロー）", "UNFOLLOW（フォロー解除）", "WITHDRAW（引き出し）", "OTHER（その他）"],
    sayAction: (a, s) => `アカウント #${s} として「${a}」を1件行う署名です。`,
    sayBatch: (n, s) => `アカウント #${s} として、${n} 件のアクションをまとめて行う署名です。`,
    saySession: "クイックサイン用の鍵に、あなたの代わりに署名する権限を渡す署名です。",
    sayTokenSession: (p) => `アカウント #${p} だけに限って、クイックサイン用の鍵に権限を渡す署名です。`,
    sayRevoke: "クイックサイン用の鍵の権限を取り消す署名です。",
    sayQs: "クイックサイン用の鍵に、あなたの代わりに署名する権限を渡す署名です（文章の形）。",
    sender: "送り手のアカウント", receiver: "相手のアカウント", receiverCawonce: "相手の投稿の番号（cawonce）", network: "ネットワーク", cawonce: "この署名の番号（cawonce）",
    pays: "支払い", payTo: (amt, id) => `#${id} に ${amt} CAW`, tip: (amt) => `バリデータへのチップ ${amt} CAW`, noPay: "なし",
    text: "本文", textBytes: (n) => `${n} バイト`, textUtf8: "UTF-8 として読める内容", textCompressed: "UTF-8 の文字として読めません。CAW の本文は smltxt で圧縮して載せるので、このページでは中身まで戻せません。",
    baseCost: (c) => `この種類の基本の費用：${c} CAW（上限の仕組みが有効なら、それより下がることがあります）`,
    withdraw: (amt) => `ウォレットへ ${amt} CAW を引き出します。`,
    qsInAction: "本文が「qs:」で始まり、長さが 71 バイトです。CawActions はこれをクイックサインの鍵の登録として扱います。",
    qxInAction: "本文が「qx:」で始まり、長さが 23 バイトです。CawActions はこれをクイックサインの鍵の取り消しとして扱います。",
    qsBad: "本文が「qs:」/「qx:」で始まりますが、長さが決まった形と違うので、コントラクトは何もしません（失敗にもなりません）。",
    batchNote: "まとめて行う中身は、ここでは「actionsHash」というハッシュ値でしか見えません。どのアクションが含まれるかは、この署名からは確かめられません。",
    firstCawonce: "最初の番号（cawonce）", actionCount: "件数", actionsHash: "まとめた中身のハッシュ",
    sessionKey: "権限を受け取る鍵", expiry: "期限", scope: "許すアクション", spend: "使ってよい上限", tipRate: "1件あたりのチップの上限", nonce: "nonce", owner: "持ち主のウォレット", profileId: "対象のアカウント",
    expiryIn: (d) => `（今から約 ${d}）`, expired: "（すでに過ぎています。コントラクトは受け付けません）",
    noLimit: "上限なし（0）", spendWhole: (n) => `${n} CAW`,
    noLimitFlag: "使ってよい上限が 0 です。CawActions は上限が 0 より大きいときだけ確かめるので、0 は「上限なし」として扱われます。",
    longExpiry: "期限が1年より先です。",
    withdrawBit: "許すアクションに WITHDRAW（引き出し）が入っています。コントラクトはこの署名を受け付けません（NoWithdraw）。",
    withdrawMasked: "WITHDRAW の印はコントラクト側で外されるので、引き出しは許されません。",
    tooHigh: "上限の値が、コントラクトの決めている最大値を超えています。コントラクトは受け付けません（SpendLimitTooHigh）。",
    qsLines: "行の数", qsOk: "コントラクトの読み取り規則（SessionMessageParser）どおりの形です。",
    qsFail: (why) => `この文章は、コントラクトの読み取り規則で失敗します：${why}`,
    qsWhy: {
      lines: (n) => `行の数が 13 ではなく ${n} です`, head: "1行目が「Enable Quick Sign」ではありません", spend: "上限の行は「数字＋M/K/B」で始まる必要があり、0 や文字だけ（例：No limit）は通りません",
      tip: "チップの行が「数字（＋M/K/B）＋半角スペース＋CAW」の形ではありません", date: "期限の行が「日 月(英語) 年 時:分:秒 UTC」の形ではないか、日付として成り立ちません",
      key: "鍵の行が「0x」＋16進40文字ではありません", zeroKey: "鍵がゼロアドレスです",
    },
    scopeAll: "WITHDRAW 以外のすべて（この形では固定）", unknownField: "（この形にない項目）",
  },
  en: {
    title: "CAW Signature Decoder", badge: "Prototype / no network",
    lead1: "Paste a signing request from your wallet to see, following the CAW contract source, what signing it would do.",
    lead2: "What you paste is read only inside this browser and is sent nowhere, not even to this caw-reader's server. Do not paste signatures or private keys (they are not needed). The contracts it compares against are the ones this caw-reader reads.",
    ph: "Paste eth_signTypedData_v4 JSON (domain / types / primaryType / message), or personal_sign text (or hex starting with 0x).",
    go: "Decode", samples: "Examples:", sPost: "Post", sSession: "Quick Sign (typed)", sQs: "Quick Sign (text)", sNoLimit: "\"No limit\" text",
    foot: "Basis: GilgameshCaw/Caw solidity/contracts (MIT, master 97cd13f). Under each item the file and line that say so are shown. This page does not judge; decide whether to sign after reading what it shows.",
    empty: "Nothing was pasted.", unreadable: "Could not read it. Paste typed-data JSON or the message text.",
    kindTyped: (p) => `Typed data (EIP-712) · ${p}`, kindPersonal: "Signing a text message (personal_sign)",
    notCaw: "This does not match any of the shapes the CAW contracts accept.",
    domain: "Addressed to", chain: "Chain", contract: "Contract", dname: "Name / version",
    chainName: { 84532: "Base Sepolia (testnet)", 8453: "Base (mainnet)", 11155111: "Ethereum Sepolia", 1: "Ethereum mainnet" },
    knownC: (n) => `The same address as a contract this caw-reader reads: ${n}`,
    unknownC: "This is not the address of a contract this caw-reader reads. Check by other means (such as the node portal's consistency check) whether it is an official CAW address.",
    otherChain: "This is not Base or Base Sepolia. CAW signatures of this kind are addressed to the L2 (Base) contracts.",
    nameMismatch: (got, exp) => `The domain name is "${got}". For this kind of signature the contract uses "${exp}"; if they differ the contract does not accept the signature.`,
    typeMismatch: (exp) => `The type definition does not match the contract's. The contract's definition: ${exp}`,
    typeOk: "The type definition matches the contract's exactly.",
    actionNames: ["CAW (post)", "LIKE", "UNLIKE", "RECAW", "FOLLOW", "UNFOLLOW", "WITHDRAW", "OTHER"],
    sayAction: (a, s) => `A signature to do one "${a}" as account #${s}.`,
    sayBatch: (n, s) => `A signature to do ${n} actions at once as account #${s}.`,
    saySession: "A signature that lets a Quick Sign key sign on your behalf.",
    sayTokenSession: (p) => `A signature that lets a Quick Sign key sign on your behalf, for account #${p} only.`,
    sayRevoke: "A signature that revokes a Quick Sign key.",
    sayQs: "A signature that lets a Quick Sign key sign on your behalf (text form).",
    sender: "Sending account", receiver: "Other account", receiverCawonce: "Number of their post (cawonce)", network: "Network", cawonce: "Number of this action (cawonce)",
    pays: "Payments", payTo: (amt, id) => `${amt} CAW to #${id}`, tip: (amt) => `${amt} CAW tip to the validator`, noPay: "None",
    text: "Body", textBytes: (n) => `${n} bytes`, textUtf8: "Readable as UTF-8", textCompressed: "Not readable as UTF-8 text. CAW bodies are stored smltxt-compressed, which this page does not decompress.",
    baseCost: (c) => `Base cost of this kind: ${c} CAW (can be lower when the cost cap is active)`,
    withdraw: (amt) => `Withdraws ${amt} CAW to the wallet.`,
    qsInAction: "The body starts with \"qs:\" and is 71 bytes long. CawActions treats this as registering a Quick Sign key.",
    qxInAction: "The body starts with \"qx:\" and is 23 bytes long. CawActions treats this as revoking a Quick Sign key.",
    qsBad: "The body starts with \"qs:\"/\"qx:\" but its length is not the fixed one, so the contract does nothing with it (and does not fail).",
    batchNote: "The batched actions are visible here only as the hash \"actionsHash\". Which actions are included cannot be checked from this signature.",
    firstCawonce: "First number (cawonce)", actionCount: "Count", actionsHash: "Hash of the batched actions",
    sessionKey: "Key receiving the power", expiry: "Expires", scope: "Allowed actions", spend: "Spending cap", tipRate: "Tip cap per action", nonce: "nonce", owner: "Owner wallet", profileId: "Account",
    expiryIn: (d) => ` (about ${d} from now)`, expired: " (already passed; the contract will not accept it)",
    noLimit: "No cap (0)", spendWhole: (n) => `${n} CAW`,
    noLimitFlag: "The spending cap is 0. CawActions checks the cap only when it is greater than 0, so 0 means no cap.",
    longExpiry: "The expiry is more than a year away.",
    withdrawBit: "WITHDRAW is among the allowed actions. The contract does not accept this signature (NoWithdraw).",
    withdrawMasked: "The contract removes the WITHDRAW bit, so withdrawals are not allowed.",
    tooHigh: "The cap is above the contract's maximum. The contract does not accept it (SpendLimitTooHigh).",
    qsLines: "Lines", qsOk: "The shape follows the contract's parsing rules (SessionMessageParser).",
    qsFail: (why) => `The contract's parsing rules reject this message: ${why}`,
    qsWhy: {
      lines: (n) => `it has ${n} lines instead of 13`, head: "the first line is not \"Enable Quick Sign\"", spend: "the cap line must start with a number followed by M/K/B; 0 or words alone (such as No limit) are rejected",
      tip: "the tip line is not \"number (+ M/K/B) + space + CAW\"", date: "the expiry line is not \"day Month year hh:mm:ss UTC\" or is not a valid date",
      key: "the key line is not \"0x\" + 40 hex characters", zeroKey: "the key is the zero address",
    },
    scopeAll: "Everything except WITHDRAW (fixed for this form)", unknownField: "(not part of this shape)",
  }
};
let lang = "ja";
const t = (k) => T[lang][k];

// From solidity/contracts (master 97cd13f)
const TYPES = {
  ActionData: { str: "ActionData(uint8 actionType,uint32 senderId,uint32 receiverId,uint32 receiverCawonce,uint32 networkId,uint32 cawonce,uint32[] recipients,uint64[] amounts,bytes text)", domain: "Caw Protocol", src: "CawActions.sol:83-95, 192-194" },
  ActionBatch: { str: "ActionBatch(uint32 senderId,uint32 firstCawonce,uint32 actionCount,bytes32 actionsHash)", domain: "Caw Protocol", src: "CawActions.sol:199-201" },
  SessionDelegation: { str: "SessionDelegation(address sessionKey,uint64 expiry,uint8 scopeBitmap,uint256 spendLimit,uint64 perActionTipRate,uint256 nonce)", domain: "CawProfileLedger", src: "CawProfileLedger.sol:190-192, 733-761" },
  TokenSessionDelegation: { str: "TokenSessionDelegation(uint32 profileId,address sessionKey,uint64 expiry,uint8 scopeBitmap,uint256 spendLimit,uint64 perActionTipRate,uint256 nonce)", domain: "CawProfileLedger", src: "CawProfileLedger.sol:198-200, 814-845" },
  RevokeSession: { str: "RevokeSession(address owner,address sessionKey,uint64 expiry)", domain: "CawProfileLedger", src: "CawProfileLedger.sol:194-196, 930-932" },
};
let KNOWN = {};       // filled from /api/status (the contracts this reader reads)
let CHAIN = null;
const BASE_COST = { 0: 5000, 1: 2000, 3: 4000, 4: 30000 }; // CawActions.sol:1310-1336 (whole CAW, before cap)
const MAX_SESSION_SPEND = 10n ** 27n; // 1_000_000_000 ether (CawProfileLedger.sol:206)
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function big(v) { try { return BigInt(v); } catch { return null; } }
function fmt(n) { const b = big(n); return b == null ? String(n) : b.toLocaleString("en-US"); }
function hexToBytes(h) { h = String(h).replace(/^0x/i, ""); if (h.length % 2 || /[^0-9a-f]/i.test(h)) return null; const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; }
function toHex(b) { return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); }
function utf8(b) { try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return null; } }
function readUint(b, o, n) { let v = 0n; for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(b[o + i]); return v; }
function duration(sec) {
  const d = Math.round(sec / 86400);
  if (lang === "ja") return d >= 365 ? `${(d / 365).toFixed(1)} 年` : d >= 1 ? `${d} 日` : `${Math.max(1, Math.round(sec / 3600))} 時間`;
  return d >= 365 ? `${(d / 365).toFixed(1)} years` : d >= 1 ? `${d} days` : `${Math.max(1, Math.round(sec / 3600))} hours`;
}
function dateStr(sec) { const d = new Date(Number(sec) * 1000); return isNaN(d) ? String(sec) : d.toISOString().replace(".000Z", " UTC").replace("T", " "); }

function parseInput(raw) {
  const s = raw.trim();
  if (!s) return { kind: "empty" };
  if (s[0] === "{" || s[0] === "[" || s[0] === "\"") {
    try {
      let j = JSON.parse(s);
      if (typeof j === "string") j = JSON.parse(j);
      if (Array.isArray(j)) { const x = j.find((v) => (typeof v === "object" && v && v.types) || (typeof v === "string" && v.includes("\"types\""))); j = typeof x === "string" ? JSON.parse(x) : x; }
      if (j && j.types && j.primaryType && j.message) return { kind: "typed", data: j };
    } catch { /* fall through to text */ }
  }
  if (/^0x[0-9a-f]*$/i.test(s)) { const b = hexToBytes(s); const txt = b && utf8(b); if (txt != null) return { kind: "text", text: txt, fromHex: true }; }
  return { kind: "text", text: raw };
}

function typeString(data, name) {
  const fields = data.types[name];
  if (!Array.isArray(fields)) return null;
  return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

// ---------- Quick Sign text (mirrors SessionMessageParser.sol)
function parseQuickSign(text) {
  const lines = text.split("\n");
  const W = t("qsWhy");
  if (lines.length !== 13) return { fail: W.lines(lines.length), lines: lines.length };
  if (lines[0] !== "Enable Quick Sign") return { fail: W.head, lines: 13 };
  const sp = /^(\d+)([MKB])/.exec(lines[3]);
  if (lines[3].length < 5 || !sp || BigInt(sp[1]) === 0n) return { fail: W.spend, lines: 13 };
  const mul = { M: 1000000n, K: 1000n, B: 1000000000n };
  const spendLimit = BigInt(sp[1]) * mul[sp[2]];
  const tp = /^(\d*)([MKB])? CAW( \(.*\))?$/.exec(lines[6]);
  if (lines[6].length < 5 || !tp) return { fail: W.tip, lines: 13 };
  const tip = BigInt(tp[1] || "0") * (tp[2] ? mul[tp[2]] : 1n);
  if (tip > 18446744073709551615n) return { fail: W.tip, lines: 13 };
  const dm = /^(\d+) ([A-Za-z]+) (\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(lines[9]);
  if (lines[9].length <= 20 || !dm) return { fail: W.date, lines: 13 };
  const day = +dm[1], mon = MONTHS.indexOf(dm[2]) + 1, yr = +dm[3], hh = +dm[4], mi = +dm[5], ss = +dm[6];
  const leap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!mon || day < 1 || day > dim[mon - 1] || hh >= 24 || mi >= 60 || ss >= 60 || yr > 2200 || yr < 1970) return { fail: W.date, lines: 13 };
  const expiry = Date.UTC(yr, mon - 1, day, hh, mi, ss) / 1000;
  if (!/^[\x00-\x7f]{2}[0-9a-fA-F]{40}$/.test(lines[12])) return { fail: W.key, lines: 13 };
  if (/^..0{40}$/.test(lines[12])) return { fail: W.zeroKey, lines: 13 };
  return { ok: true, spendLimit, tip, expiry, key: "0x" + lines[12].slice(2) }; // the contract reads the 40 hex chars after the first two (SessionMessageParser.sol:265-270)
}

// ---------- rendering helpers
function flags(card, list) { for (const [lvl, msg, src] of list) { const f = el("div", "flag " + lvl, msg); if (src) f.append(el("div", "src", src)); card.append(f); } }
function addRow(dl, k, v, mono, src) { dl.append(el("dt", null, k)); const dd = el("dd", mono ? "mono" : null, v); if (src) dd.append(el("div", "src", src)); dl.append(dd); }
function sessionRows(dl, m, fl, opts) {
  addRow(dl, t("sessionKey"), m.sessionKey, true);
  const exp = big(m.expiry), now = BigInt(Math.floor(Date.now() / 1000));
  let ex = dateStr(m.expiry);
  if (exp != null) ex += exp <= now ? t("expired") : t("expiryIn")(duration(Number(exp - now)));
  addRow(dl, t("expiry"), ex, false);
  if (exp != null && exp - now > 365n * 86400n) fl.push(["warn", t("longExpiry")]);
  if (opts.scope) {
    const raw = Number(m.scopeBitmap) & 0xff, bm = opts.masked ? raw & 0xbf : raw;
    const names = t("actionNames").filter((_, i) => bm & (1 << i));
    addRow(dl, t("scope"), names.join(" / ") || "—", false, "CawProfileLedger.sol:730 (bit = ActionType)");
    if (raw & 0x40) fl.push(opts.masked ? ["info", t("withdrawMasked"), "CawProfileLedger.sol:828"] : ["stop", t("withdrawBit"), "CawProfileLedger.sol:746"]);
  } else addRow(dl, t("scope"), t("scopeAll"), false, opts.scopeSrc);
  const sl = big(m.spendLimit);
  addRow(dl, t("spend"), sl === 0n ? t("noLimit") : t("spendWhole")(fmt(m.spendLimit)), false, "CawProfileLedger.sol:731, CawActions.sol:1377-1383");
  if (sl === 0n) fl.push(["warn", t("noLimitFlag"), "CawActions.sol:1377"]);
  if (sl != null && sl > MAX_SESSION_SPEND) fl.push(["stop", t("tooHigh"), "CawProfileLedger.sol:206, 712"]);
  addRow(dl, t("tipRate"), t("spendWhole")(fmt(m.perActionTipRate)), false);
}

function renderTyped(card, data) {
  const p = data.primaryType, spec = TYPES[p], d = data.domain || {}, m = data.message || {};
  card.append(el("p", "sigkind", t("kindTyped")(p)));
  const fl = [], dl = el("dl", "rows");
  const say = el("p", "say");
  card.append(say);
  // domain
  const cid = Number(d.chainId);
  addRow(dl, t("domain") + " · " + t("chain"), `${cid} ${t("chainName")[cid] || ""}`, false);
  const vc = String(d.verifyingContract || "").toLowerCase();
  addRow(dl, t("domain") + " · " + t("contract"), d.verifyingContract || "—", true);
  addRow(dl, t("domain") + " · " + t("dname"), `${d.name ?? "—"} / ${d.version ?? "—"}`, false);
  if (KNOWN[vc]) fl.push(["info", t("knownC")(KNOWN[vc])]); else fl.push(["warn", t("unknownC")]);
  if (cid !== 84532 && cid !== 8453) fl.push(["warn", t("otherChain")]);
  if (!spec) { say.textContent = t("notCaw"); flags(card, fl); card.append(dl); return; }
  if (d.name !== spec.domain || String(d.version) !== "1") fl.push(["stop", t("nameMismatch")(`${d.name} / ${d.version}`, `${spec.domain} / 1`), spec.src]);
  const ts = typeString(data, p);
  fl.push(ts === spec.str ? ["info", t("typeOk"), spec.src] : ["stop", t("typeMismatch")(spec.str), spec.src]);

  if (p === "ActionData") {
    const at = Number(m.actionType), names = t("actionNames");
    say.textContent = t("sayAction")(names[at] ?? `#${at}`, m.senderId);
    addRow(dl, t("sender"), `#${m.senderId}`, false);
    if (at === 1 || at === 2 || at === 3 || at === 4 || at === 5 || Number(m.receiverId)) addRow(dl, t("receiver"), `#${m.receiverId}`, false);
    if (Number(m.receiverCawonce)) addRow(dl, t("receiverCawonce"), String(m.receiverCawonce), false);
    addRow(dl, t("network"), `#${m.networkId}`, false);
    addRow(dl, t("cawonce"), String(m.cawonce), false);
    if (BASE_COST[at] != null) fl.push(["info", t("baseCost")(fmt(BASE_COST[at])), "CawActions.sol:1302-1336"]);
    const rec = (m.recipients || []).map(String), amt = (m.amounts || []).map(String);
    const pays = rec.map((r, i) => t("payTo")(fmt(amt[i] ?? "?"), r));
    if (amt.length === rec.length + 1) pays.push(t("tip")(fmt(amt[amt.length - 1])));
    if (at === 6) fl.push(["warn", t("withdraw")(fmt(amt[0] ?? "?")), "CawActions.sol:1337-1338"]);
    else addRow(dl, t("pays"), pays.length ? pays.join(" / ") : t("noPay"), false, "CawActions.sol:1666-1676");
    const b = typeof m.text === "string" ? hexToBytes(m.text) : null;
    if (b) {
      addRow(dl, t("text"), t("textBytes")(b.length), false);
      const isQ = b.length >= 3 && b[0] === 0x71 && b[2] === 0x3a && (b[1] === 0x73 || b[1] === 0x78);
      if (isQ && at === 7) {
        if (b[1] === 0x73 && b.length === 71) {
          fl.push(["warn", t("qsInAction"), "CawActions.sol:1452-1483"]);
          sessionRows(dl, { sessionKey: toHex(b.slice(3, 23)), expiry: readUint(b, 23, 8), spendLimit: readUint(b, 31, 32), perActionTipRate: readUint(b, 63, 8) }, fl, { scope: false, scopeSrc: "CawProfileLedger.sol:884-899" });
        } else if (b[1] === 0x78 && b.length === 23) {
          fl.push(["info", t("qxInAction"), "CawActions.sol:1484-1487"]);
          addRow(dl, t("sessionKey"), toHex(b.slice(3, 23)), true);
        } else fl.push(["info", t("qsBad"), "CawActions.sol:1472-1478"]);
      } else {
        const s = utf8(b);
        if (s != null && /^[\P{C}\n\t]*$/u.test(s)) addRow(dl, t("textUtf8"), s, false);
        else if (b.length) addRow(dl, t("textUtf8"), t("textCompressed"), false, "CawActions.sol:94");
      }
    }
  } else if (p === "ActionBatch") {
    say.textContent = t("sayBatch")(m.actionCount, m.senderId);
    addRow(dl, t("sender"), `#${m.senderId}`, false);
    addRow(dl, t("firstCawonce"), String(m.firstCawonce), false);
    addRow(dl, t("actionCount"), String(m.actionCount), false);
    addRow(dl, t("actionsHash"), String(m.actionsHash), true);
    fl.push(["warn", t("batchNote"), "CawActions.sol:766-830"]);
  } else if (p === "SessionDelegation") {
    say.textContent = t("saySession");
    sessionRows(dl, m, fl, { scope: true });
    addRow(dl, t("nonce"), String(m.nonce), false);
  } else if (p === "TokenSessionDelegation") {
    say.textContent = t("sayTokenSession")(m.profileId);
    addRow(dl, t("profileId"), `#${m.profileId}`, false);
    sessionRows(dl, m, fl, { scope: true, masked: true });
    addRow(dl, t("nonce"), String(m.nonce), false);
  } else if (p === "RevokeSession") {
    say.textContent = t("sayRevoke");
    addRow(dl, t("owner"), m.owner, true);
    addRow(dl, t("sessionKey"), m.sessionKey, true);
    addRow(dl, t("expiry"), dateStr(m.expiry), false);
  }
  flags(card, fl);
  card.append(dl);
}

function renderText(card, text) {
  card.append(el("p", "sigkind", t("kindPersonal")));
  const say = el("p", "say"); card.append(say);
  const q = parseQuickSign(text), fl = [], dl = el("dl", "rows");
  if (!text.startsWith("Enable Quick Sign")) { say.textContent = t("notCaw"); flags(card, fl); card.append(el("pre", "mono qsraw", text)); return; }
  say.textContent = t("sayQs");
  if (q.fail) { fl.push(["stop", t("qsFail")(q.fail), "SessionMessageParser.sol:40-171, CawProfileLedger.sol:782-807"]); flags(card, fl); card.append(el("pre", "mono qsraw", text)); return; }
  fl.push(["info", t("qsOk"), "SessionMessageParser.sol:40-67"]);
  sessionRows(dl, { sessionKey: q.key, expiry: q.expiry, spendLimit: q.spendLimit, perActionTipRate: q.tip }, fl, { scope: false, scopeSrc: "CawProfileLedger.sol:807" });
  flags(card, fl); card.append(dl);
}

let inp = null, out = null;
function run() {
  out.textContent = "";
  const card = el("section", "sec"); out.append(card);
  const p = parseInput(inp.value);
  if (p.kind === "empty") { card.append(el("p", null, t("empty"))); return; }
  if (p.kind === "typed") renderTyped(card, p.data); else renderText(card, p.text);
}

// ---------- samples (shapes from the contract source; values are made up)
const now = Math.floor(Date.now() / 1000);
const TD = (primaryType, name, fields, message) => JSON.stringify({ types: { EIP712Domain: [
  { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
  [primaryType]: fields }, primaryType, domain: { name, version: "1", chainId: CHAIN?.chainId ?? 84532,
  verifyingContract: name === "Caw Protocol" ? (CHAIN?.cawActions ?? "0x73246104f57001EDC6d0659Fa37Afb672a76E763") : (CHAIN?.ledger ?? "0x93593A023629EB84B389770d76A81C5f982F02a9") }, message }, null, 2);
const F = (s) => s.split(",").map((x) => { const [type, name] = x.trim().split(" "); return { name, type }; });
const d = new Date((now + 30 * 86400) * 1000);
const qsDate = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} 00:00:00 UTC`;
const samples = () => ({
  post: TD("ActionData", "Caw Protocol", F("uint8 actionType,uint32 senderId,uint32 receiverId,uint32 receiverCawonce,uint32 networkId,uint32 cawonce,uint32[] recipients,uint64[] amounts,bytes text"),
    { actionType: 0, senderId: 2, receiverId: 0, receiverCawonce: 0, networkId: 1, cawonce: 110, recipients: [], amounts: [], text: "0x" + Array.from(new TextEncoder().encode("hello CAW"), (x) => x.toString(16).padStart(2, "0")).join("") }),
  session: TD("SessionDelegation", "CawProfileLedger", F("address sessionKey,uint64 expiry,uint8 scopeBitmap,uint256 spendLimit,uint64 perActionTipRate,uint256 nonce"),
    { sessionKey: "0x1111111111111111111111111111111111111111", expiry: now + 400 * 86400, scopeBitmap: 191, spendLimit: 0, perActionTipRate: 1000, nonce: 0 }),
  qs: ["Enable Quick Sign", "------------------", "Spend limit:", "5M CAW", "", "Tip per action:", "1000 CAW", "", "Expires:", qsDate, "", "CAW Key:", "0x1111111111111111111111111111111111111111"].join("\n"),
  nolimit: ["Enable Quick Sign", "------------------", "Spend limit:", "No limit", "", "Tip per action:", "1000 CAW", "", "Expires:", qsDate, "", "CAW Key:", "0x1111111111111111111111111111111111111111"].join("\n"),
});


// Called by app.js for the #/sign route
function render(container, language, chain) {
  lang = language === "en" ? "en" : "ja";
  CHAIN = chain && chain.cawActions ? chain : null;
  KNOWN = {};
  if (CHAIN) {
    KNOWN[String(CHAIN.cawActions).toLowerCase()] = "CawActions (" + CHAIN.chainId + ")";
    if (CHAIN.ledger) KNOWN[String(CHAIN.ledger).toLowerCase()] = "CawProfileLedger (" + CHAIN.chainId + ")";
  }
  const intro = el("section", "sec");
  intro.append(el("p", null, t("lead1")), el("p", null, t("lead2")));
  inp = el("textarea", "signin"); inp.spellcheck = false; inp.placeholder = t("ph"); inp.setAttribute("aria-label", t("ph"));
  const bar = el("div", "signbar");
  const go = el("button", "rbtn", t("go")); go.type = "button"; go.addEventListener("click", run);
  bar.append(go, el("span", "mut", t("samples")));
  const S = samples();
  for (const [k, label] of [["post", "sPost"], ["session", "sSession"], ["qs", "sQs"], ["nolimit", "sNoLimit"]]) {
    const b = el("button", "rbtn", t(label)); b.type = "button";
    b.addEventListener("click", () => { inp.value = S[k]; run(); });
    bar.append(b);
  }
  intro.append(inp, bar);
  out = el("div");
  const foot = el("section", "sec"); foot.append(el("p", null, t("foot")));
  container.append(intro, out, foot);
}

window.CawSign = { render, _parseQuickSign: (text, language) => { lang = language || "en"; return parseQuickSign(text); } };
})();
