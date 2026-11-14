// Saved state + the spaced-repetition scheduler. One localStorage key, written synchronously on every change.
import { SCENES, LINES, CHENGYU, REGISTER, PY } from './content.gen.js';

const KEY = 'chongshi.v1';
const fresh = () => ({ v: 1, cards: {}, scenes: {}, best: {}, days: {}, km: 0, mine: [], tests: [], talks: [], gen: [], t: 0, epoch: 0, set: { slow: false, sfx: true, py: false, voice: '', voice2: '', ear: false } });

let S = load();

function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && o.v === 1) return { ...fresh(), ...o, set: { ...fresh().set, ...o.set } };
  } catch {}
  return fresh();
}
let saveFailed = false;
const listeners = [];
export const onSave = (fn) => listeners.push(fn);
export const storageBroken = () => saveFailed;
function save() {
  S.t = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(S)); saveFailed = false; } catch { saveFailed = true; }
  for (const fn of listeners) fn();
}

/* ---------- phrases: the authored ones, plus any the learner kept from live conversations ---------- */
// Scenes Claude wrote for this learner join the authored ones on a line of their own.
const AUTHORED_SCENES = SCENES.length;
const MY_LINE = { id: 'L6', zh: '自编', en: 'Written for you' };
function syncScenes() {
  SCENES.length = AUTHORED_SCENES;
  for (const sc of S.gen) if (sc && sc.id && Array.isArray(sc.lines) && Array.isArray(sc.chunks)) SCENES.push(sc);
  const has = LINES.includes(MY_LINE);
  if (SCENES.length > AUTHORED_SCENES && !has) LINES.push(MY_LINE);
  if (SCENES.length === AUTHORED_SCENES && has) LINES.pop();
}
syncScenes();
const AUTHORED = SCENES.slice(0, AUTHORED_SCENES).flatMap((s) => s.chunks);
const MINE = { id: 'mine', zh: '我的对话', en: 'Kept from conversations', chunks: [] };
function mineChunk(m) {
  const py = (m.py || '').trim().split(/\s+/).filter(Boolean);
  if (py.length === (m.zh.match(/[\u4e00-\u9fff]/g) || []).length) PY[m.zh] = py.join(' '); // only if it lines up with the characters
  return { id: m.zh, zh: m.zh, en: m.en, note: m.note || '', ex: [m.zh], exEn: m.en, scene: 'mine' };
}
export const CHUNKS = [...AUTHORED];
function syncMine() {
  CHUNKS.length = AUTHORED.length;
  for (const sc of SCENES.slice(AUTHORED_SCENES)) for (const c of sc.chunks) if (!CHUNKS.some((x) => x.id === c.id)) CHUNKS.push(c);
  for (const m of S.mine) if (m && m.zh && m.en && !CHUNKS.some((c) => c.id === m.zh)) CHUNKS.push(mineChunk(m));
}
syncMine();
export function addMine(m) {
  if (CHUNKS.some((c) => c.id === m.zh)) return false;
  S.mine.push({ zh: m.zh, py: m.py || '', en: m.en, note: m.note || '' });
  save();
  syncMine();
  return true;
}
export const sceneById = (id) => (id === 'mine' ? MINE : SCENES.find((s) => s.id === id));
export function addScene(sc) {
  S.gen.push(sc);
  if (S.gen.length > 40) S.gen.shift();
  save();
  syncScenes();
  syncMine();
}

// Local calendar day as an integer, so "due" flips at the learner's midnight.
export const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);

/* ---------- settings ---------- */
export const settings = () => S.set;
export function setSetting(k, v) { S.set[k] = v; save(); }

/* ---------- scheduler ----------
   Tuned for relearning, not first-time learning. A card answered instantly on first sight was never
   really lost, so it jumps 10 days out; one that took effort comes back in 3; a blank comes back tomorrow.
   A later lapse on a well-established card keeps a quarter of its interval (savings) instead of resetting. */
export const card = (id) => S.cards[id];

export function rate(id, r, first = 10) { // r: 0 blanked · 1 took effort · 2 instant; `first` = days out for an instant first sight
  const t = today();
  let c = S.cards[id];
  if (!c) {
    c = S.cards[id] = { i: r === 2 ? first : r === 1 ? 3 : 0, e: 2.3, n: 0, l: 0, d: t };
  } else if (r === 0) {
    c.l++;
    c.e = Math.max(1.5, c.e - 0.2);
    c.i = c.i >= 8 ? Math.round(c.i * 0.25) : 0;
  } else if (c.d <= t) { // early successes don't inflate the interval
    const base = Math.max(c.i, 1);
    c.i = Math.min(180, r === 2 ? Math.round(base * c.e * 1.25) + 1 : Math.round(base * 1.7) + 1);
    if (r === 2) c.e = Math.min(3, c.e + 0.1);
  }
  c.n++;
  if (r === 0) c.d = t + 1;
  else if (c.d <= t || c.n === 1) c.d = t + c.i + (c.i >= 7 ? Math.round((Math.random() - 0.5) * c.i * 0.2) : 0);
  save();
  return c;
}

// A slip in a puzzle pulls the card forward so it shows up in the next Recall session.
export function shake(id) {
  const c = S.cards[id];
  if (c && c.d > today()) { c.d = today(); save(); }
}

export function nextGap(id, r, first = 10) { // days until the card would return, for the rating buttons
  const c = S.cards[id];
  if (r === 0) return 1;
  if (!c) return r === 2 ? first : 3;
  if (c.d > today()) return c.d - today();
  const base = Math.max(c.i, 1);
  return Math.min(180, r === 2 ? Math.round(base * c.e * 1.25) + 1 : Math.round(base * 1.7) + 1);
}

export function strength(id) {
  const c = S.cards[id];
  if (!c) return 'new';
  return c.i < 4 ? 'rusty' : c.i < 21 ? 'warm' : 'solid';
}

const isDue = (id) => S.cards[id] && S.cards[id].d <= today();

function sceneTouched(id) {
  if (id === 'mine') return true;
  const p = S.scenes[id];
  return !!(p && (p.listen || p.read || p.speak));
}
// New chunks arrive in line order, but scenes you have already heard jump the queue: meet it in context first.
function newChunks() {
  const unseen = CHUNKS.filter((c) => !S.cards[c.id]);
  return [...unseen.filter((c) => sceneTouched(c.scene)), ...unseen.filter((c) => !sceneTouched(c.scene))];
}

// Recall introduces a phrase only after its scene has been heard or read. The one exception is a learner
// who has not opened any scene yet: they get a cold check of the first phrases, which is a fair diagnostic.
export function recallQueue(n = 12, maxNew = 6) {
  const due = CHUNKS.filter((c) => isDue(c.id)).sort((a, b) => S.cards[a.id].d - S.cards[b.id].d).slice(0, n);
  const met = newChunks().filter((c) => sceneTouched(c.scene));
  const fresh = met.length || Object.keys(S.scenes).length ? met : newChunks();
  return [...due, ...fresh.slice(0, Math.min(maxNew, n - due.length))];
}
// Nothing due and nothing new: offer the weakest cards anyway.
export function aheadQueue(n = 8) {
  return CHUNKS.filter((c) => S.cards[c.id]).sort((a, b) => S.cards[a.id].i - S.cards[b.id].i || S.cards[a.id].d - S.cards[b.id].d).slice(0, n);
}

export function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Chunk-based puzzles favour shaky cards, then other seen cards, then the next unseen ones.
export function pickChunks(n) {
  const seen = CHUNKS.filter((c) => S.cards[c.id]);
  const shaky = shuffle(seen.filter((c) => S.cards[c.id].l > 0 || S.cards[c.id].i < 4));
  const rest = shuffle(seen.filter((c) => !shaky.includes(c)));
  const unseen = shuffle(newChunks().slice(0, n * 2));
  const out = [];
  const add = (list, k) => {
    for (const c of list) {
      if (k <= 0 || out.length >= n) break;
      if (!out.includes(c)) { out.push(c); k--; }
    }
  };
  add(shaky, Math.ceil(n / 2));
  add(unseen, Math.ceil(n / 4));
  add(rest, n);
  add(unseen, n);
  add(shaky, n);
  return shuffle(out.slice(0, n));
}
// Idioms and register items: due first, then new, then whatever comes back soonest.
export function pickSpaced(items, n) {
  const due = shuffle(items.filter((x) => isDue(x.id)));
  const unseen = shuffle(items.filter((x) => !S.cards[x.id]));
  const later = items.filter((x) => S.cards[x.id] && !isDue(x.id)).sort((a, b) => S.cards[a.id].d - S.cards[b.id].d);
  return [...due, ...unseen, ...later].slice(0, n);
}

/* ---------- scenes ---------- */
export const STEPS = ['listen', 'check', 'read', 'speak'];
export const sceneState = (id) => S.scenes[id] || {};
export function markScene(id, step) {
  const p = (S.scenes[id] ||= {});
  p[step] = (p[step] || 0) + 1;
  p.t = Date.now();
  save();
}
export const sceneDone = (id) => STEPS.every((s) => sceneState(id)[s]);
export function nextScene() {
  return SCENES.find((s) => !sceneDone(s.id)) || [...SCENES].sort((a, b) => (sceneState(a.id).t || 0) - (sceneState(b.id).t || 0))[0];
}
// For the ears-only ride: the first scene never listened to, else the one heard longest ago.
export function nextListen(skip = []) {
  const pool = SCENES.filter((s) => !skip.includes(s.id));
  return pool.find((s) => !sceneState(s.id).listen) || [...pool].sort((a, b) => (sceneState(a.id).t || 0) - (sceneState(b.id).t || 0))[0] || SCENES[0];
}

/* ---------- mileage, rides, bests ---------- */
export function addKm(n) { S.km += n; save(); }
export function markDay() {
  const t = today();
  S.days[t] = (S.days[t] || 0) + 1;
  for (const d of Object.keys(S.days)) if (+d < t - 60) delete S.days[d];
  save();
}
export function weekRides() {
  const t = today();
  const dow = (new Date().getDay() + 6) % 7; // Monday = 0
  let n = 0;
  for (let d = t - dow; d <= t; d++) if (S.days[d]) n++;
  return n;
}
export const activeDays = () => S.days;
export const best = (game) => S.best[game] || 0;
export function setBest(game, v) { if (v > best(game)) { S.best[game] = v; save(); } }

export function stats() {
  const b = { new: 0, rusty: 0, warm: 0, solid: 0 };
  for (const c of CHUNKS) b[strength(c.id)]++;
  return {
    ...b,
    total: CHUNKS.length,
    due: CHUNKS.filter((c) => isDue(c.id)).length,
    km: S.km,
    week: weekRides(),
    idioms: CHENGYU.filter((y) => S.cards[y.id]).length,
    register: REGISTER.filter((r) => S.cards[r.id]).length,
  };
}

/* ---------- graded word bank (loaded on demand: it is 300 KB) ---------- */
export const LEVEL_SIZE = { 1: 150, 2: 150, 3: 300, 4: 600, 5: 1300, 6: 2500 }; // official HSK 1-6 list sizes
let bank = null;
export async function loadWords() {
  if (bank) return bank;
  const { WORDS } = await import('./words.gen.js');
  const levels = {};
  const by = new Map();
  for (const [lv, text] of Object.entries(WORDS)) {
    levels[lv] = text.split('\n').map((line) => {
      const [w, y, g, p] = line.split('\t');
      const x = { w, y, g, p: p[0], fair: !p.endsWith('!'), lv: +lv, id: 'w:' + w };
      by.set(w, x);
      return x;
    });
  }
  // Per-character readings, for annotating text nobody wrote pinyin for (Claude's replies, generated scenes):
  // a single-character entry wins, otherwise the reading that character has most often inside longer words.
  const votes = new Map();
  for (const x of by.values()) {
    const chars = [...x.w];
    const syl = x.y.split(' ');
    if (chars.length !== syl.length) continue;
    chars.forEach((ch, i) => {
      const m = votes.get(ch) || votes.set(ch, new Map()).get(ch);
      m.set(syl[i], (m.get(syl[i]) || 0) + (chars.length === 1 ? 50 : 1));
    });
  }
  const one = new Map();
  for (const [ch, m] of votes) one.set(ch, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  bank = { levels, by, one };
  return bank;
}
// Best-effort pinyin for arbitrary text: longest dictionary word first, then single characters.
// Registers the result so zh() can show it. Dictionary readings, so no tone sandhi.
export function annotate(text, b = bank) {
  if (!b || PY[text]) return;
  const chars = [...text];
  const out = [];
  for (let i = 0; i < chars.length;) {
    if (!/[\u4e00-\u9fff]/.test(chars[i])) { i++; continue; }
    let took = 0;
    for (let len = Math.min(4, chars.length - i); len >= 2 && !took; len--) {
      const x = b.by.get(chars.slice(i, i + len).join(''));
      const syl = x ? x.y.split(' ') : [];
      if (syl.length === len) { out.push(...syl); took = len; }
    }
    if (!took) { out.push(b.one.get(chars[i]) || ''); took = 1; }
    i += took;
  }
  PY[text] = out.join(' ');
}
// The level the Words deck draws new words from: the first band the last level check found shaky.
export const frontier = () => (S.tests.length ? S.tests[S.tests.length - 1].frontier : 5);
// A word missed in the level check goes straight into the deck, due now.
export function seedWord(w) {
  const id = 'w:' + w;
  if (!S.cards[id]) S.cards[id] = { i: 0, e: 2.3, n: 0, l: 1, d: today() };
  else S.cards[id].d = Math.min(S.cards[id].d, today());
  save();
}
export function wordQueue(b, n = 15, maxNew = 10) {
  const t = today();
  const due = [];
  for (const id in S.cards) {
    if (id.startsWith('w:') && S.cards[id].d <= t && b.by.has(id.slice(2))) due.push(b.by.get(id.slice(2)));
  }
  due.sort((x, y) => S.cards[x.id].d - S.cards[y.id].d);
  const out = due.slice(0, n);
  const want = Math.min(n, out.length + maxNew);
  for (let lv = frontier(); lv <= 7 && out.length < want; lv++) {
    for (const x of b.levels[lv]) {
      if (out.length >= want) break;
      if (!S.cards[x.id]) out.push(x);
    }
  }
  return out;
}
export function wordStats() {
  const t = today();
  const o = { seen: 0, due: 0, solid: 0 };
  for (const id in S.cards) {
    if (!id.startsWith('w:')) continue;
    o.seen++;
    if (S.cards[id].d <= t) o.due++;
    if (S.cards[id].i >= 10) o.solid++;
  }
  return o;
}

/* ---------- level checks and conversations ---------- */
export const tests = () => S.tests;
export function saveTest(t) {
  S.tests.push(t);
  if (S.tests.length > 24) S.tests.shift();
  save();
}
export const talks = () => S.talks;
export function saveTalk(t) {
  S.talks.push(t);
  if (S.talks.length > 30) S.talks.shift();
  save();
}

// Pinyin for everything that arrived without it: scenes Claude wrote and phrases kept from conversations.
// Loads the word bank in the background the first time it is needed; `then` runs once the pinyin is in place.
export function annotateScenes(then) {
  const gen = SCENES.slice(AUTHORED_SCENES);
  const loose = S.mine.filter((m) => !PY[m.zh]);
  if (!gen.length && !loose.length) return;
  loadWords().then((b) => {
    for (const sc of gen) {
      for (const t of [sc.zh, ...sc.lines.map((l) => l.zh), ...sc.qs.flatMap((q) => [q.q, ...q.opts]), ...sc.chunks.flatMap((c) => [c.zh, c.ex.join('')])]) annotate(t, b);
    }
    for (const m of loose) annotate(m.zh, b);
    if (then) then();
  }).catch(() => {});
}

/* ---------- merging two copies of the same learner's progress (sync between devices) ---------- */
export const snapshot = () => JSON.stringify(S);
export const stamp = () => S.t;
// Folds a copy from another device into this one without losing work done on either:
// each card keeps whichever side reviewed it more, lists are united, counters take the larger value.
// A reset (a newer epoch) wins outright. Returns true if anything here changed.
export function mergeIn(o) {
  if (!o || o.v !== 1 || typeof o.cards !== 'object') return false;
  const before = JSON.stringify({ ...S, t: 0 });
  if ((o.epoch || 0) > (S.epoch || 0)) S = { ...fresh(), ...o, set: { ...fresh().set, ...o.set } };
  else if ((o.epoch || 0) === (S.epoch || 0)) {
    for (const [id, c] of Object.entries(o.cards)) {
      const mine = S.cards[id];
      if (!mine || c.n > mine.n || (c.n === mine.n && c.d > mine.d)) S.cards[id] = c;
    }
    for (const [id, p] of Object.entries(o.scenes || {})) {
      const mine = (S.scenes[id] ||= {});
      for (const k of Object.keys(p)) mine[k] = Math.max(mine[k] || 0, p[k] || 0);
    }
    for (const [k, v] of Object.entries(o.best || {})) S.best[k] = Math.max(S.best[k] || 0, v);
    for (const [k, v] of Object.entries(o.days || {})) S.days[k] = Math.max(S.days[k] || 0, v);
    S.km = Math.max(S.km, o.km || 0);
    const unite = (key, id) => {
      const seen = new Set(S[key].map(id));
      for (const x of o[key] || []) if (x && !seen.has(id(x))) S[key].push(x);
    };
    unite('mine', (x) => x.zh);
    unite('gen', (x) => x.id);
    unite('tests', (x) => x.t);
    unite('talks', (x) => x.t);
    S.tests.sort((a, b) => a.t - b.t);
    S.talks.sort((a, b) => a.t - b.t);
    if ((o.t || 0) > (S.t || 0)) S.set = { ...S.set, ...o.set };
  }
  if (JSON.stringify({ ...S, t: 0 }) === before) return false;
  save();
  syncScenes();
  syncMine();
  return true;
}

/* ---------- backup ---------- */
export function exportCode() {
  return 'CS1.' + btoa(unescape(encodeURIComponent(JSON.stringify(S))));
}
export function importCode(code) {
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim().replace(/^CS1\./, '')))));
    if (!o || o.v !== 1 || typeof o.cards !== 'object') return false;
    S = { ...fresh(), ...o, set: { ...fresh().set, ...o.set } };
    S.epoch = Date.now(); // a restore replaces what other devices hold, like a reset
    save();
    syncScenes();
    syncMine();
    return true;
  } catch { return false; }
}
export function reset() {
  const keep = S.set;
  S = fresh();
  S.set = keep;
  S.epoch = Date.now();
  save();
  syncScenes();
  syncMine();
}
