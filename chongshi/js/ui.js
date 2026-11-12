// Small DOM helpers shared by every screen.
import { PY } from './content.gen.js';
import { speak, stop, sfx, speechMode, listen, record, compare } from './audio.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const HAN = /[一-鿿]/;
export const isHan = (ch) => HAN.test(ch);

// Chinese text with pinyin riding above each character. The pinyin stays in the DOM and is shown
// or hidden by the `py-on` class on <html>. `hit` (from audio.compare) tints characters heard / missed.
export function zh(text, { cls = '', hit = null } = {}) {
  const span = h('span', { class: 'zh ' + cls, lang: 'zh-CN' });
  const py = PY[text] ? PY[text].split(' ') : null;
  let n = 0;
  let i = 0;
  for (const ch of text) {
    if (HAN.test(ch)) {
      const mark = hit ? (hit[i] ? 'hit' : 'miss') : null;
      span.append(h('ruby', { class: mark }, ch, py ? h('rt', null, py[n++] || '') : null));
    } else if (hit && hit[i] !== null) {
      span.append(h('span', { class: hit[i] ? 'hit' : 'miss' }, ch));
    } else span.append(ch);
    i += ch.length;
  }
  return span;
}
export const pinyinOf = (text) => PY[text] || '';

const P = {
  home: '<circle cx="12" cy="12" r="7.5"/><path d="M2.5 12h19"/>',
  scenes: '<path d="M4 5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M20 10v6a1 1 0 0 1-1 1h-1v2.5L15 17"/>',
  recall: '<rect x="6" y="3.5" width="13" height="15" rx="2"/><path d="M4 7.5V19a1.5 1.5 0 0 0 1.5 1.5H15"/><path d="M10 9h5M10 13h3"/>',
  games: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  gear: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.6"/><circle cx="8" cy="17" r="2.6"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  phones: '<path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2"/><rect x="3.5" y="13.5" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="13.5" width="4" height="6.5" rx="1.5"/>',
  seat: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M8.5 19.5h7M12 16v3.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  next: '<path d="M6 5.5v13l9-6.5z" fill="currentColor" stroke="none"/><path d="M18 5.5v13" stroke-width="2.5"/>',
  again: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 4.5v4h4"/>',
  arrow: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
};
export function icon(name) {
  return h('span', { class: 'ic', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>` });
}

export const go = (hash) => { location.hash = hash; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

export function button(label, cls, onclick, ic) {
  return h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick }, ic ? icon(ic) : null, h('span', null, label));
}

export function sayButton(text, opts, label = 'Play audio') {
  return h('button', { class: 'say', type: 'button', 'aria-label': label, onclick: (e) => { e.stopPropagation(); speak(text, opts); } }, icon('sound'));
}

// The in-car strip map: one dot per stop, lit as you pass it.
export function strip(total, done, current = done) {
  const el = h('div', { class: 'strip', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done });
  for (let i = 0; i < total; i++) el.append(h('i', { class: i < done ? 'passed' : i === current ? 'here' : '' }));
  return el;
}

// Microphone control. Calls onResult with {heard, score, hit} (live recognition) or {url} (a recording).
// Returns null when no microphone path exists, so callers fall back to say-it-aloud-and-check.
export function speakBox(target, onResult) {
  if (speechMode() === 'none') return null;
  const status = h('div', { class: 'mic-status', 'aria-live': 'polite' });
  const btn = h('button', { class: 'mic', type: 'button', 'aria-label': 'Speak your answer' }, icon('mic'));
  const box = h('div', { class: 'speakbox' }, btn, status);
  const idle = () => (speechMode() === 'sr' ? 'Tap the mic and say it' : speechMode() === 'rec' ? 'Tap to record yourself' : 'No microphone here. Say it aloud, then check.');
  status.textContent = idle();
  let active = null;
  let timer;
  const live = (on) => box.classList.toggle('live', on);

  btn.onclick = async () => {
    if (active) return active();
    stop();
    sfx('cue');
    if (speechMode() === 'sr') {
      live(true);
      status.textContent = 'Listening…';
      const l = listen((t) => { status.textContent = t || 'Listening…'; });
      active = l.stop;
      const res = await l.promise;
      active = null;
      live(false);
      if (!box.isConnected) return;
      if (res.text) {
        status.textContent = 'Tap to try again';
        onResult({ heard: res.text, ...compare(target, res.text) });
      } else if (speechMode() !== 'sr') {
        status.textContent = speechMode() === 'rec' ? "Live recognition isn't available right now. Tap to record yourself instead." : idle();
        btn.disabled = speechMode() === 'none';
      } else status.textContent = "Didn't catch that. Tap to try again.";
    } else if (speechMode() === 'rec') {
      status.textContent = 'Starting the microphone…';
      const r = await record();
      if (!r) {
        status.textContent = idle();
        btn.disabled = true;
        return;
      }
      live(true);
      status.textContent = 'Recording. Tap to stop.';
      active = async () => {
        clearTimeout(timer);
        active = null;
        live(false);
        const url = await r.stop();
        if (!box.isConnected) return;
        status.textContent = 'Tap to record again';
        onResult({ url });
      };
      timer = setTimeout(() => active && active(), 20000);
    }
  };
  return box;
}

// What came back from the microphone, shown under the model answer.
export function heardLine(res, target) {
  if (!res) return null;
  if (res.url) {
    const a = new Audio(res.url);
    return h('div', { class: 'heard' },
      button('You', 'chip', () => { stop(); a.currentTime = 0; a.play(); }, 'play'),
      button('Model', 'chip', () => { a.pause(); speak(target); }, 'play'),
      h('span', { class: 'heard-note' }, 'Compare by ear'));
  }
  const pct = Math.round(res.score * 100);
  return h('div', { class: 'heard' },
    h('span', { class: 'pct ' + (pct >= 85 ? 'good' : pct >= 60 ? 'mid' : 'low') }, pct + '%'),
    h('span', { class: 'heard-note' }, 'Heard: ', h('span', { class: 'zh', lang: 'zh-CN' }, res.heard)));
}

// End-of-activity panel. `actions` are buttons; the first should be the way forward.
export function summary({ zhTitle, title, rows = [], note, actions = [] }) {
  return h('section', { class: 'summary' },
    h('div', { class: 'summary-sign' }, h('b', { class: 'zh', lang: 'zh-CN' }, zhTitle), h('span', null, title)),
    rows.length ? h('dl', { class: 'summary-rows' }, rows.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))) : null,
    note ? h('p', { class: 'summary-note' }, note) : null,
    h('div', { class: 'actions' }, actions));
}
