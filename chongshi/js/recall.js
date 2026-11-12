// Recall: an English cue, you produce the Chinese (aloud if you can), then rate how it came back.
import * as store from './store.js';
import { speak, stop, sfx } from './audio.js';
import { h, zh, go, button, sayButton, strip, speakBox, heardLine, summary, isHan } from './ui.js';
import { wayOut } from './journey.js';

const RATINGS = [
  [0, '忘了', 'Blanked', 'no'],
  [1, '想了想', 'Took effort', 'mid'],
  [2, '脱口而出', 'Instant', 'ok'],
];
const gapLabel = (d) => (d <= 1 ? 'tomorrow' : d < 30 ? `${d} days` : `${Math.round(d / 7)} weeks`);

export function recallView() {
  const el = h('div', { class: 'page recall' });
  let onKey = null;
  const setKeys = (fn) => { onKey = fn; };
  const keydown = (e) => {
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (onKey && onKey(e.key)) e.preventDefault();
  };
  document.addEventListener('keydown', keydown);

  function session(queue, ahead) {
    const total = queue.length;
    const tally = [0, 0, 0];
    const repeats = new Map();
    let passed = 0;

    function front() {
      const c = queue[0];
      const sc = store.sceneById(c.scene);
      let res = null;
      const hint = h('div', { class: 'hint', lang: 'zh-CN', hidden: true }, [...c.zh].map((ch, i) => (!isHan(ch) || i === 0 ? ch : '＿')).join(''));
      const box = speakBox(c.zh, (r) => { res = r; back(c, res); });
      el.replaceChildren(
        strip(total, passed),
        h('article', { class: 'card' },
          h('div', { class: 'card-from' }, h('span', { lang: 'zh-CN' }, sc.zh), ' · ', store.card(c.id) ? 'review' : 'first look'),
          h('p', { class: 'cue-label' }, 'Say it in Chinese'),
          h('p', { class: 'cue-en' }, c.en),
          hint,
          box),
        h('div', { class: 'actions sticky' },
          button('Show answer', 'primary', () => back(c, res)),
          button('Hint', 'ghost', () => { hint.hidden = false; })));
      setKeys((k) => {
        if (k === ' ' || k === 'Enter') { back(c, res); return true; }
        if (k === 'h') { hint.hidden = false; return true; }
      });
    }

    function back(c, res) {
      speak(c.zh);
      const rateIt = (r) => {
        stop();
        sfx(r === 0 ? 'lift' : 'good');
        store.rate(c.id, r);
        queue.shift();
        const seen = repeats.get(c.id) || 0;
        if (r === 0 && seen < 2) {
          // A blank comes back a few cards later in this same session.
          repeats.set(c.id, seen + 1);
          queue.splice(Math.min(3, queue.length), 0, c);
        } else {
          passed++;
          tally[seen ? 0 : r]++;
        }
        if (queue.length) front(); else finish();
      };
      el.replaceChildren(
        strip(total, passed),
        h('article', { class: 'card back' },
          h('p', { class: 'cue-en small' }, c.en),
          h('div', { class: 'answer' }, zh(c.zh, { cls: 'big', hit: res?.hit }), sayButton(c.zh)),
          heardLine(res, c.zh),
          h('p', { class: 'chunk-note' }, c.note),
          h('button', { class: 'example', type: 'button', onclick: () => speak(c.ex.join('')) },
            zh(c.ex.join('')), h('span', { class: 'en' }, c.exEn))),
        h('div', { class: 'rate sticky' }, RATINGS.map(([r, z, en, cls]) =>
          h('button', { class: 'rate-btn ' + cls, type: 'button', onclick: () => rateIt(r) },
            h('b', { lang: 'zh-CN' }, z), h('span', null, en), h('small', null, gapLabel(store.nextGap(c.id, r)))))));
      setKeys((k) => {
        if ('123'.includes(k)) { rateIt(+k - 1); return true; }
        if (k === ' ') { speak(c.zh); return true; }
      });
    }

    function finish() {
      setKeys(null);
      const km = tally[1] + tally[2] * 2;
      store.addKm(km);
      store.markDay();
      sfx('done');
      const more = store.recallQueue();
      el.replaceChildren(summary({
        zhTitle: '复习完了',
        title: ahead ? 'Extra practice done' : 'Recall complete',
        rows: [['Instant', tally[2]], ['Took effort', tally[1]], ['Blanked', tally[0]], ['Distance', `+${km} km`]],
        note: tally[0] ? 'The ones you blanked on come back tomorrow.' : 'Nothing slipped. The intervals just got longer.',
        actions: wayOut(more.length ? 'Another round' : null, more.length ? start : null),
      }));
    }
    front();
  }

  function start() {
    const queue = store.recallQueue();
    if (queue.length) return session(queue, false);
    const ahead = store.aheadQueue();
    setKeys(null);
    el.replaceChildren(summary({
      zhTitle: '都复习完了',
      title: 'Nothing is due',
      note: 'Every phrase you have met is scheduled for later. New ones arrive when you ride the next scene.',
      actions: [...wayOut(), button('Next station: ' + store.nextScene().zh, 'ghost', () => go('scene-' + store.nextScene().id)), ...(ahead.length ? [button('Practise the weakest ' + ahead.length, 'ghost', () => session(ahead, true))] : [])],
    }));
  }
  start();

  return { el, title: '复习', sub: 'Recall · cue first, Chinese from memory', destroy: () => document.removeEventListener('keydown', keydown) };
}
