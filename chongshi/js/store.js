// Saved state + the spaced-repetition scheduler. One localStorage key, written synchronously on every change.
import { SCENES, CHENGYU, REGISTER } from './content.gen.js';

const KEY = 'chongshi.v1';
const fresh = () => ({ v: 1, cards: {}, scenes: {}, best: {}, days: {}, km: 0, set: { slow: false, sfx: true, py: false, voice: '' } });

let S = load();

function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && o.v === 1) return { ...fresh(), ...o, set: { ...fresh().set, ...o.set } };
  } catch {}
  return fresh();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {}
}

export const CHUNKS = SCENES.flatMap((s) => s.chunks);
export const sceneById = (id) => SCENES.find((s) => s.id === id);

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

export function rate(id, r) { // r: 0 blanked · 1 took effort · 2 instant
  const t = today();
  let c = S.cards[id];
  if (!c) {
    c = S.cards[id] = { i: r === 2 ? 10 : r === 1 ? 3 : 0, e: 2.3, n: 0, l: 0, d: t };
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

export function nextGap(id, r) { // days until the card would return, for the rating buttons
  const c = S.cards[id];
  if (r === 0) return 1;
  if (!c) return r === 2 ? 10 : 3;
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

/* ---------- backup ---------- */
export function exportCode() {
  return 'CS1.' + btoa(unescape(encodeURIComponent(JSON.stringify(S))));
}
export function importCode(code) {
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(code.trim().replace(/^CS1\./, '')))));
    if (!o || o.v !== 1 || typeof o.cards !== 'object') return false;
    S = { ...fresh(), ...o, set: { ...fresh().set, ...o.set } };
    save();
    return true;
  } catch { return false; }
}
export function reset() {
  const keep = S.set;
  S = fresh();
  S.set = keep;
  save();
}
