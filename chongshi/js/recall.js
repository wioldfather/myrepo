// Recall: two decks on one scheduler.
//   说法 Phrases  an English cue; you produce the Chinese (aloud if you can), then rate how it came back
//   词汇 Words    a graded HSK word, by eye or by ear; you recall its reading and meaning, then rate
import * as store from './store.js';
import { speak, stop, sfx, canSpeak } from './audio.js';
import { h, fill, zh, icon, go, button, sayButton, strip, speakBox, heardLine, summary, isHan } from './ui.js';
import { wayOut } from './journey.js';
import { backend, ask, MESSAGES } from './llm.js';

const RATINGS = [
  [0, '忘了', 'Blanked', 'no'],
  [1, '想了想', 'Took effort', 'mid'],
  [2, '脱口而出', 'Instant', 'ok'],
];
const gapLabel = (d) => (d <= 1 ? 'tomorrow' : d < 30 ? `${d} days` : `${Math.round(d / 7)} weeks`);
const FIRST = { phrase: 10, word: 30 }; // days out when a card is instant on first sight

export function recallView(arg) {
  const deck = arg === 'words' ? 'word' : 'phrase';
  const body = h('div', { class: 'recall-body' });
  const tabs = h('div', { class: 'decks', role: 'tablist' });
  const el = h('div', { class: 'page recall' }, tabs, body);
  let alive = true;
  let onKey = null;
  const setKeys = (fn) => { onKey = fn; };
  const keydown = (e) => {
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (onKey && onKey(e.key)) e.preventDefault();
  };
  document.addEventListener('keydown', keydown);

  function paintTabs() {
    const due = { phrase: store.stats().due, word: store.wordStats().due };
    fill(tabs, ...[['phrase', 'recall', '说法', 'Phrases'], ['word', 'recall-words', '词汇', 'Words']].map(([k, hash, z, en]) =>
      h('a', { href: '#' + hash, class: k === deck ? 'on' : '', role: 'tab', 'aria-selected': k === deck },
        h('b', { lang: 'zh-CN' }, z), h('span', null, en), due[k] ? h('em', null, due[k]) : null)));
  }

  /* One session over a queue of cards. `face` supplies the two sides for this deck. */
  function session(queue, { ahead = false, face, again }) {
    const total = queue.length;
    const tally = [0, 0, 0];
    const repeats = new Map();
    let passed = 0;

    function front() {
      const c = queue[0];
      let res = null;
      const show = () => back(c, res);
      const f = face.front(c, (r) => { res = r; show(); });
      fill(body, strip(total, passed), f.card,
        h('div', { class: 'actions sticky' }, button('Show answer', 'primary', show), ...(f.extra || [])));
      setKeys((k) => {
        if (k === ' ' || k === 'Enter') { show(); return true; }
        return f.key ? f.key(k) : false;
      });
    }

    function back(c, res) {
      speak(c.zh || c.w);
      const rateIt = (r) => {
        stop();
        sfx(r === 0 ? 'lift' : 'good');
        store.rate(c.id, r, FIRST[deck]);
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
      fill(body, strip(total, passed), face.back(c, res),
        h('div', { class: 'rate sticky' }, RATINGS.map(([r, z, en, cls]) =>
          h('button', { class: 'rate-btn ' + cls, type: 'button', onclick: () => rateIt(r) },
            h('b', { lang: 'zh-CN' }, z), h('span', null, en), h('small', null, gapLabel(store.nextGap(c.id, r, FIRST[deck])))))));
      setKeys((k) => {
        if ('123'.includes(k)) { rateIt(+k - 1); return true; }
        if (k === ' ') { speak(c.zh || c.w); return true; }
      });
    }

    function finish() {
      setKeys(null);
      const km = tally[1] + tally[2] * 2;
      store.addKm(km);
      store.markDay();
      sfx('done');
      paintTabs();
      fill(body, summary({
        zhTitle: '复习完了',
        title: ahead ? 'Extra practice done' : deck === 'word' ? 'Words complete' : 'Recall complete',
        rows: [['Instant', tally[2]], ['Took effort', tally[1]], ['Blanked', tally[0]], ['Distance', `+${km} km`]],
        note: tally[0] ? 'The ones you blanked on come back tomorrow.' : 'Nothing slipped. The intervals just got longer.',
        actions: wayOut('Another round', again),
      }));
    }
    front();
  }

  /* ---------- phrases ---------- */
  const phraseFace = {
    front(c, onSpoken) {
      const sc = store.sceneById(c.scene);
      const hint = h('div', { class: 'hint', lang: 'zh-CN', hidden: true }, [...c.zh].map((ch, i) => (!isHan(ch) || i === 0 ? ch : '＿')).join(''));
      return {
        card: h('article', { class: 'card' },
          h('div', { class: 'card-from' }, h('span', { lang: 'zh-CN' }, sc.zh), ' · ', store.card(c.id) ? 'review' : 'first look'),
          h('p', { class: 'cue-label' }, 'Say it in Chinese'),
          h('p', { class: 'cue-en' }, c.en),
          hint,
          speakBox(c.zh, onSpoken)),
        extra: [button('Hint', 'ghost', () => { hint.hidden = false; })],
        key: (k) => { if (k === 'h') { hint.hidden = false; return true; } },
      };
    },
    back(c, res) {
      return h('article', { class: 'card back' },
        h('p', { class: 'cue-en small' }, c.en),
        h('div', { class: 'answer' }, zh(c.zh, { cls: 'big', hit: res?.hit }), sayButton(c.zh)),
        heardLine(res, c.zh),
        c.note ? h('p', { class: 'chunk-note' }, c.note) : null,
        c.ex.length > 1 ? h('button', { class: 'example', type: 'button', onclick: () => speak(c.ex.join('')) }, zh(c.ex.join('')), h('span', { class: 'en' }, c.exEn)) : null);
    },
  };
  function phrases() {
    const queue = store.recallQueue();
    if (queue.length) return session(queue, { face: phraseFace, again: phrases });
    const ahead = store.aheadQueue();
    setKeys(null);
    fill(body, summary({
      zhTitle: '都复习完了',
      title: 'Nothing is due',
      note: 'Every phrase you have met is scheduled for later. New ones arrive when you ride the next scene.',
      actions: [...wayOut(), button('Next station: ' + store.nextScene().zh, 'ghost', () => go('scene-' + store.nextScene().id)), ...(ahead.length ? [button('Practise the weakest ' + ahead.length, 'ghost', () => session(ahead, { ahead: true, face: phraseFace, again: phrases }))] : [])],
    }));
  }

  /* ---------- words ---------- */
  let canAsk = false;
  const wordFace = {
    front(x) {
      const byEar = store.settings().ear && canSpeak();
      if (byEar) speak(x.w);
      const earBtn = h('button', { class: 'btn chip', type: 'button', 'aria-pressed': String(!!store.settings().ear), onclick: () => { store.setSetting('ear', !store.settings().ear); words(); } }, 'By ear');
      return {
        card: h('article', { class: 'card word' },
          h('div', { class: 'card-from' }, 'HSK ' + (x.lv === 7 ? '7–9' : x.lv), ' · ', store.card(x.id) ? 'review' : 'first look'),
          h('p', { class: 'cue-label' }, byEar ? 'Listen. What does it mean?' : 'Reading and meaning?'),
          byEar
            ? h('button', { class: 'bigplay', type: 'button', 'aria-label': 'Play again', onclick: () => speak(x.w) }, icon('sound'))
            : h('p', { class: 'word-zh', lang: 'zh-CN' }, x.w)),
        extra: canSpeak() ? [earBtn] : [],
      };
    },
    back(x) {
      const more = h('p', { class: 'example-ai', hidden: true });
      const moreBtn = canAsk ? button('In a sentence', 'chip', async () => {
        moreBtn.disabled = true;
        more.hidden = false;
        more.textContent = 'Asking Claude…';
        try {
          more.textContent = await ask({ quick: true, system: `Write one short, natural Mandarin sentence that a university career advisor might say or hear, using the word 「${x.w}」. Put the sentence on the first line and its English translation on the second line. Plain text only: no pinyin, no markdown, no quotation marks.` });
        } catch (e) { more.textContent = MESSAGES[e.code] || MESSAGES.failed; moreBtn.disabled = false; }
      }) : null;
      return h('article', { class: 'card back word' },
        h('div', { class: 'answer' }, h('span', { class: 'word-zh', lang: 'zh-CN' }, x.w), sayButton(x.w)),
        h('p', { class: 'word-py' }, x.y),
        h('p', { class: 'word-en' }, x.g),
        moreBtn, more);
    },
  };
  let bank = null;
  async function words() {
    if (!bank) {
      fill(body, h('p', { class: 'note' }, 'Loading the word bank…'));
      try { [bank, canAsk] = [await store.loadWords(), !!(await Promise.race([backend(), new Promise((r) => setTimeout(() => r(null), 1500))]))]; } catch {
        fill(body, h('p', { class: 'note warn' }, 'The word bank could not be loaded. Check your connection and try again.'));
        return;
      }
      if (!alive) return;
    }
    const queue = store.wordQueue(bank);
    const tested = store.tests().length;
    if (!queue.length) {
      fill(body, summary({ zhTitle: '词汇', title: 'No words left at this level', note: 'Retake the level check to move the starting point.', actions: [button('Level check', 'primary', () => go('level')), ...wayOut()] }));
      return;
    }
    session(queue, { face: wordFace, again: words });
    if (!tested) body.prepend(h('p', { class: 'note warn' }, 'Starting at HSK 5. ', h('a', { href: '#level' }, 'Take the level check'), ' so this deck starts where your gaps are.'));
  }

  paintTabs();
  if (deck === 'word') words(); else phrases();
  return {
    el,
    title: '复习',
    sub: deck === 'word' ? 'Words · graded HSK vocabulary' : 'Recall · cue first, Chinese from memory',
    destroy: () => { alive = false; document.removeEventListener('keydown', keydown); },
  };
}
