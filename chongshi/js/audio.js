// Everything that makes or hears sound: speech synthesis, sound effects, speech recognition,
// microphone recording, and the fuzzy comparison between what was said and the target sentence.
import { HOMO } from './content.gen.js';
import { CLIPS } from './audio.gen.js';
import { settings } from './store.js';

/* ---------- text to speech ---------- */
const synth = window.speechSynthesis;
let voices = [];
function refresh() {
  try { voices = synth ? synth.getVoices() : []; } catch { voices = []; }
}
if (synth) {
  refresh();
  if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh);
}

// Voice quality varies wildly between devices. Apple ships "Eloquence" and novelty voices (Eddy, Flo, Grandma,
// Rocko, Albert, Zarvox…) for every language, and older systems have formant synthesisers; all of them sound
// like robots. Never choose those. Among the rest, prefer voices the system marks as enhanced or neural.
const ROBOTIC = /eloquence|espeak|pico|festival|\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph)\b|bad news|good news/i;
const label = (v) => v.name + ' ' + (v.voiceURI || '');
const robotic = (v) => ROBOTIC.test(label(v));
const rank = (v) => {
  const n = label(v);
  return (/premium|enhanced|natural|neural|online|siri/i.test(n) ? 4 : 0)
    + (/tingting|ting-ting|lili|lilian|yu-?shu|shanshan|binbin|bobo|meijia|xiaoxiao|xiaoyi|yunxi|yunyang|yunjian|google|samantha|ava\b|allison|zoe|evan|nathan|aria|jenny/i.test(n) ? 2 : 0)
    - (/huihui|kangkang|yaoyao|compact|zira|david|hazel/i.test(n) ? 1 : 0);
};
const best = (list) => {
  const good = list.filter((v) => !robotic(v));
  return (good.length ? good : list).sort((a, b) => rank(b) - rank(a));
};

export function zhVoices() {
  refresh();
  const cn = voices.filter((v) => /^(zh[-_](CN|Hans)|cmn[-_]Hans|zh$)/i.test(v.lang));
  return best(cn.length ? cn : voices.filter((v) => /^(zh[-_]TW|cmn[-_]Hant)/i.test(v.lang)));
}
// 'ok' · 'novoice' (voices exist, none Mandarin) · 'unknown' (list not loaded yet; try anyway) · 'unsupported'
export function ttsStatus() {
  if (!synth) return 'unsupported';
  refresh();
  if (!voices.length) return 'unknown';
  return zhVoices().length ? 'ok' : 'novoice';
}
let mute = false; // set when a browser accepts speech calls but never actually starts talking
export const canSpeak = () => !mute && ['ok', 'unknown'].includes(ttsStatus());

function pickVoice(lang, alt) {
  if (lang !== 'zh') {
    const us = voices.filter((v) => /^en[-_]US/i.test(v.lang));
    return best(us.length ? us : voices.filter((v) => /^en/i.test(v.lang)))[0] || null;
  }
  const zs = zhVoices();
  const main = zs.find((v) => v.voiceURI === settings().voice) || zs[0] || null;
  if (!alt || settings().voice2 === 'same') return main;
  // The student gets a second voice only when a genuinely good one exists; otherwise the same voice is used
  // and the advisor's lines are pitched slightly lower instead.
  return zs.find((v) => v.voiceURI === settings().voice2 && v !== main) || zs.find((v) => v !== main && rank(v) >= 2) || main;
}
export const hasSecondVoice = () => pickVoice('zh', true) !== pickVoice('zh', false);

const estimate = (text, rate) => ((text.match(/[一-鿿]/g) || []).length * 300 + (text.match(/[A-Za-z0-9]/g) || []).length * 75 + 700) / rate;

let cur = null;
export function stop() {
  const c = cur;
  cur = null;
  if (c) c.fin(false);
  try { if (synth) synth.cancel(); } catch {}
}

/* ---------- recorded lines ----------
   Scene dialogue and phrases have studio-quality recordings: a few files, each holding many lines, with every
   line's start and end listed in audio.gen.js. A line plays by seeking into its file. Anything without a
   recording (English cues, questions, Claude's replies, the word bank) falls through to the device voice. */
const USE_CLIPS = !window.__NO_CLIPS; // tests of the device-voice paths switch recordings off
export const hasClip = (text) => USE_CLIPS && !!CLIPS[text];
const files = new Map();
// Fetched whole and played from memory: works offline once cached, and avoids range requests.
function clipFile(name) {
  if (!files.has(name)) {
    files.set(name, fetch('audio/' + name + '.mp3').then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  }
  return files.get(name);
}
// One shared element, started once from a tap (see prime), so later lines may start on their own on iOS.
const player = typeof Audio === 'function' ? new Audio() : null;
function playClip([name, start, end], rate) {
  return new Promise((resolve) => {
    stop();
    let done = false;
    let timer;
    const me = { fin };
    function fin(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      player.pause();
      player.ontimeupdate = null;
      if (cur === me) cur = null;
      resolve(ok);
    }
    cur = me;
    clipFile(name).then((url) => {
      if (done) return;
      if (!url) { files.delete(name); return fin(null); } // not reachable: the caller falls back to the device voice
      const begin = () => {
        if (done) return;
        player.playbackRate = rate;
        player.currentTime = start;
        player.ontimeupdate = () => { if (player.currentTime >= end) fin(true); };
        timer = setTimeout(() => fin(true), ((end - start) / rate) * 1000 + 1500);
        player.play().catch(() => fin(null));
      };
      if (player.dataset.url === url && player.readyState >= 1) return begin();
      player.dataset.url = url;
      player.src = url;
      player.onloadedmetadata = begin;
      player.onerror = () => fin(null);
    });
  });
}

// Resolves true when the utterance finished, false if it was cut off or could not play.
export async function speak(text, opts = {}) {
  const { lang = 'zh', rate = 1 } = opts;
  if (lang === 'zh' && player && hasClip(text)) {
    const ok = await playClip(CLIPS[text], rate * (settings().slow ? 0.8 : 1));
    if (ok !== null) return ok;
  }
  return speakDevice(text, opts);
}
function speakDevice(text, { lang = 'zh', rate = 1, pitch = 1, alt = false } = {}) {
  return new Promise((resolve) => {
    if (!synth || mute || (lang === 'zh' && ttsStatus() === 'novoice')) return resolve(false);
    const busy = !!cur || synth.speaking || synth.pending;
    stop();
    const u = new SpeechSynthesisUtterance(text.replace(/……/g, '，').replace(/[“”]/g, ''));
    const v = pickVoice(lang, alt);
    if (v) u.voice = v;
    u.lang = lang === 'zh' ? (v ? v.lang : 'zh-CN') : 'en-US';
    u.rate = rate * (lang === 'zh' && settings().slow ? 0.8 : 1);
    u.pitch = pitch;
    let done = false;
    const me = { u, fin };
    function fin(ok) {
      if (done) return;
      done = true;
      clearTimeout(guard);
      if (cur === me) cur = null;
      resolve(ok);
    }
    let started = false;
    u.onstart = () => { started = true; };
    u.onend = () => fin(true);
    u.onerror = () => fin(false);
    // Some engines never fire onend; don't let a session hang on it. And if a browser that never told us
    // its voices also never starts speaking, stop pretending: screens fall back to their no-audio paths.
    let guard = setTimeout(() => {
      if (started) { guard = setTimeout(() => fin(true), estimate(text, u.rate)); return; }
      if (ttsStatus() === 'unknown') mute = true;
      try { synth.cancel(); } catch {}
      fin(false);
    }, 4000);
    cur = me;
    const go = () => {
      if (cur !== me) return;
      try { synth.speak(u); } catch { fin(false); }
    };
    // Chrome drops an utterance queued in the same tick as cancel().
    if (busy) setTimeout(go, 70); else go();
  });
}

/* ---------- sound effects + haptics ---------- */
let ac = null;
function ctx() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(freq, at, dur, type = 'sine', vol = 0.07) {
  const a = ctx();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  const t = a.currentTime + at;
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.03);
}
const SFX = {
  tap: () => tone(540, 0, 0.05, 'triangle', 0.05),
  lift: () => tone(380, 0, 0.05, 'triangle', 0.04),
  good: () => { tone(659, 0, 0.16); tone(988, 0.12, 0.3); }, // two-note door chime
  bad: () => { tone(208, 0, 0.16, 'triangle', 0.08); tone(185, 0.1, 0.2, 'triangle', 0.08); },
  done: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.34)),
  cue: () => tone(880, 0, 0.09, 'sine', 0.05),
};
const BUZZ = { tap: 8, lift: 6, good: [12, 40, 18], bad: [30, 50, 30], done: [15, 40, 15, 40, 30] };
export function sfx(name) {
  if (!settings().sfx) return;
  try { SFX[name]?.(); } catch {}
  try { if (BUZZ[name] && navigator.vibrate) navigator.vibrate(BUZZ[name]); } catch {}
}

// iOS only lets speech and Web Audio start from a tap. Prime both on the first one, so that audio which
// starts a moment later (a puzzle that plays on arrival, the next line of a scene) is allowed to play.
function prime() {
  try {
    if (synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); }
    ctx();
    if (player && USE_CLIPS && !player.src) {
      // a moment of silence, so the shared element counts as started by the user
      player.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      player.play().catch(() => {});
    }
  } catch {}
}
addEventListener('pointerdown', prime, { once: true, capture: true });
addEventListener('keydown', prime, { once: true, capture: true });

/* ---------- comparing speech to a target ---------- */
const CHAR_PY = {};
for (const [py, chars] of Object.entries(HOMO)) for (const ch of chars) CHAR_PY[ch] ||= py;
const UNIT = /[一-鿿]|[A-Za-z0-9]+/g;

function units(s) {
  const out = [];
  let m;
  UNIT.lastIndex = 0;
  while ((m = UNIT.exec(s))) out.push({ at: m.index, len: m[0].length, key: CHAR_PY[m[0]] || m[0].toLowerCase() });
  return out;
}
// Longest common subsequence over syllables, so homophones the recogniser picked (他/她, 在/再) still count.
// Returns the share of the target that was heard and which target characters matched.
export function compare(target, heard) {
  const a = units(target);
  const b = units(heard);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array(target.length).fill(null);
  for (const u of a) for (let k = 0; k < u.len; k++) hit[u.at + k] = false;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) { for (let k = 0; k < a[i].len; k++) hit[a[i].at + k] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { score: n ? dp[0][0] / n : 0, hit };
}
export function homophones(ch) {
  return [...(HOMO[CHAR_PY[ch]] || '')].filter((c) => c !== ch);
}

/* ---------- speech in ----------
   Three tiers, checked at runtime and demoted on failure:
   'sr'  live recognition (Chrome, Safari; needs a connection)
   'rec' record yourself and compare by ear with the model
   'none' say it aloud and self-check */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let srOff = false;
let recOff = false;
export function speechMode() {
  if (SR && !srOff) return 'sr';
  if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder && !recOff) return 'rec';
  return 'none';
}

export function listen(onInterim) {
  let r;
  let done;
  const promise = new Promise((resolve) => { done = resolve; });
  let finalText = '';
  let interim = '';
  let error = null;
  let timer;
  try {
    r = new SR();
    r.lang = 'zh-CN';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      onInterim?.(finalText + interim);
    };
    r.onerror = (e) => { error = e.error; };
    r.onend = () => {
      clearTimeout(timer);
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(error)) srOff = true;
      // A refused or missing microphone rules out recording too; a network error (offline on the train) does not.
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(error)) recOff = true;
      done({ text: (finalText || interim).trim(), error });
    };
    r.start();
    timer = setTimeout(() => { try { r.stop(); } catch {} }, 12000);
  } catch {
    srOff = true;
    done({ text: '', error: 'start-failed' });
  }
  return { promise, stop: () => { try { r.stop(); } catch {} } };
}

export async function record() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    const parts = [];
    mr.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    mr.start();
    return {
      stop: () => new Promise((resolve) => {
        mr.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(URL.createObjectURL(new Blob(parts, { type: mr.mimeType || 'audio/webm' })));
        };
        mr.stop();
      }),
    };
  } catch {
    recOff = true;
    return null;
  }
}

/* ---------- keep the screen on during an ears-only ride ---------- */
let lock = null;
let wanted = false;
export async function keepAwake(on) {
  wanted = on;
  try {
    if (on && !lock && navigator.wakeLock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) {
      const l = lock;
      lock = null;
      await l.release();
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (wanted && document.visibilityState === 'visible') keepAwake(true); });
