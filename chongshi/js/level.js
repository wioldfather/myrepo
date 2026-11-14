// 水平测试: a vocabulary level check against the HSK word lists.
// It samples words from every band, asks for the meaning by eye (the character) and by ear (audio only),
// corrects for guessing, and reports how much of each band is still there. Words missed go into the Words deck.
import * as store from './store.js';
import { speak, stop, sfx, canSpeak } from './audio.js';
import { h, fill, icon, go, button, summary } from './ui.js';

// How many words to sample per band. Bands 1-2 only need a sanity check for this learner.
const READ = { 1: 2, 2: 2, 3: 5, 4: 8, 5: 8, 6: 8, 7: 8 };
const LISTEN = { 3: 3, 4: 3, 5: 3, 6: 3, 7: 3 };
const BANDS = [['1–2', [1, 2]], ['3', [3]], ['4', [4]], ['5', [5]], ['6', [6]], ['7–9', [7]]];
const PASS = 0.7;
const bandName = (lv) => (lv >= 7 ? 'HSK 7–9' : lv <= 2 ? 'Below HSK 3' : 'HSK ' + lv);
const date = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const pct = (p) => Math.round(p * 100) + '%';

export function levelSummary() {
  const t = store.tests();
  return t.length ? t[t.length - 1] : null;
}

export function levelView() {
  const el = h('div', { class: 'page level' });
  let alive = true;
  let advance = null;
  const keydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && advance && !e.target.matches('button')) { e.preventDefault(); advance(); } };
  document.addEventListener('keydown', keydown);

  function intro() {
    const last = levelSummary();
    fill(el, 
      h('section', { class: 'panel' },
        h('h2', null, h('span', { lang: 'zh-CN' }, '水平测试'), ' Level check'),
        h('p', null, 'About six minutes. You will see or hear 56 words drawn from every HSK band and pick what each means.'),
        h('ul', { class: 'bullets' },
          h('li', null, 'Answer fast. If you do not know a word, say so: guesses are penalised, “don’t know” is not.'),
          h('li', null, canSpeak() ? 'The last 15 are by ear only, so have sound on.' : 'There is no Mandarin voice on this device, so the listening part is skipped.'),
          h('li', null, 'Words you miss go into your Words deck. The deck then starts at the first band with gaps.')),
        h('div', { class: 'actions' }, button(last ? 'Take it again' : 'Start', 'primary', start, 'arrow'))),
      last ? report(last, store.tests()[store.tests().length - 2]) : null);
  }

  async function start() {
    fill(el, h('p', { class: 'note' }, 'Loading the word bank…'));
    let bank;
    try { bank = await store.loadWords(); } catch {
      fill(el, h('p', { class: 'note warn' }, 'The word bank could not be loaded. Check your connection and try again.'), h('div', { class: 'actions' }, button('Retry', 'primary', start)));
      return;
    }
    if (!alive) return;

    const used = new Set();
    const pick = (lv, n, ok) => {
      const out = store.shuffle(bank.levels[lv].filter((x) => x.fair && !used.has(x.w) && x.g.length <= 42 && ok(x))).slice(0, n);
      out.forEach((x) => used.add(x.w));
      return out;
    };
    const options = (x) => {
      const head = (g) => g.split(/[;,(]/)[0].trim().toLowerCase();
      const pool = store.shuffle(bank.levels[x.lv].filter((y) => y !== x && y.fair && y.g.length <= 42 && head(y.g) !== head(x.g)));
      const same = pool.filter((y) => y.p === x.p);
      const wrong = [...same, ...pool.filter((y) => y.p !== x.p)].slice(0, 3);
      return store.shuffle([{ g: x.g, ok: true }, ...wrong.map((y) => ({ g: y.g, ok: false }))]);
    };
    const items = [];
    for (const [lv, n] of Object.entries(READ)) for (const x of pick(lv, n, () => true)) items.push({ x, mode: 'read', opts: options(x) });
    if (canSpeak()) for (const [lv, n] of Object.entries(LISTEN)) for (const x of pick(lv, n, (y) => [...y.w].length >= 2)) items.push({ x, mode: 'listen', opts: options(x) });

    let i = 0;
    function show() {
      const it = items[i];
      const listen = it.mode === 'listen';
      let answered = false;
      const word = h('p', { class: 'word-zh', lang: 'zh-CN', hidden: listen }, it.x.w);
      const reading = h('p', { class: 'word-py', hidden: true }, it.x.y);
      const buttons = it.opts.map((o) => h('button', { class: 'opt', type: 'button', onclick: () => answer(o) }, o.g));
      const skip = button('不认识 · Don’t know', 'ghost', () => answer(null));
      function answer(o) {
        if (answered) return next();
        answered = true;
        it.score = !o ? 0 : o.ok ? 1 : -1 / 3; // four options: a blind guess is worth nothing on average
        buttons.forEach((b, k) => { b.disabled = true; if (it.opts[k].ok) b.classList.add('ok'); else if (it.opts[k] === o) b.classList.add('no'); });
        skip.hidden = true;
        word.hidden = false;
        reading.hidden = false;
        sfx(o && o.ok ? 'tap' : 'lift');
        advance = next;
        timer = setTimeout(next, o && o.ok ? 550 : 1700);
      }
      let timer;
      function next() {
        clearTimeout(timer);
        advance = null;
        stop();
        if (!alive) return;
        if (++i < items.length) show(); else finish();
      }
      fill(el, 
        h('div', { class: 'run-head' }, h('div', { class: 'bar' }, h('i', { style: { width: (i / items.length) * 100 + '%' } })), h('span', { class: 'run-kind' }, `${i + 1} / ${items.length}`)),
        h('article', { class: 'card test', onclick: () => { if (answered) next(); } },
          h('p', { class: 'cue-label' }, listen ? '听力 · What does it mean?' : '认字 · What does it mean?'),
          listen ? h('button', { class: 'bigplay', type: 'button', 'aria-label': 'Play again', onclick: (e) => { e.stopPropagation(); speak(it.x.w); } }, icon('sound')) : null,
          word, reading),
        h('div', { class: 'opts' }, buttons),
        h('div', { class: 'actions' }, skip));
      if (listen) speak(it.x.w);
      window.scrollTo(0, 0);
    }

    function finish() {
      const score = (mode, lvs) => {
        const got = items.filter((it) => it.mode === mode && lvs.includes(it.x.lv));
        return got.length ? Math.max(0, got.reduce((s, it) => s + it.score, 0) / got.length) : null;
      };
      const lv = {};
      for (let l = 1; l <= 7; l++) lv[l] = score('read', [l]);
      let level = 0;
      for (const [, lvs] of BANDS) {
        if (score('read', lvs) >= PASS) level = lvs[lvs.length - 1]; else break;
      }
      const vocab = Math.round(Object.entries(store.LEVEL_SIZE).reduce((s, [l, size]) => s + size * lv[l], 0) / 50) * 50;
      const missed = items.filter((it) => it.score <= 0).map((it) => it.x.w);
      missed.forEach(store.seedWord);
      const result = {
        t: Date.now(), lv, level, vocab, missed: missed.length,
        frontier: Math.max(3, Math.min(7, level + 1)),
        listen: score('listen', [3, 4, 5, 6, 7]),
        readSame: score('read', [3, 4, 5, 6, 7]),
      };
      const before = levelSummary();
      store.saveTest(result);
      store.addKm(5);
      store.markDay();
      sfx('done');
      fill(el, report(result, before, true));
      window.scrollTo(0, 0);
    }
    show();
  }

  function report(r, before, fresh) {
    const band = (lvs) => lvs.reduce((s, l) => s + r.lv[l] * READ[l], 0) / lvs.reduce((s, l) => s + READ[l], 0);
    const gap = r.listen == null ? null : r.listen - r.readSame;
    const insight = gap == null ? null
      : gap < -0.15 ? 'Your eye is ahead of your ear. Ears-only rides and dictation will close that gap fastest.'
        : gap > 0.15 ? 'You recognise more by ear than on the page. Characters are the rusty part: read the scene transcripts and keep “By ear” off in the Words deck.'
          : 'Your ear and your eye are level with each other.';
    const delta = before ? r.vocab - before.vocab : 0;
    return h('section', { class: 'summary result' },
      h('div', { class: 'summary-sign' }, h('b', null, bandName(r.level)), h('span', null, fresh ? 'Level check complete' : 'Last check · ' + date(r.t))),
      h('p', { class: 'summary-note lead' }, `You recognise about ${r.vocab.toLocaleString()} of the 5,000 HSK 1–6 words`,
        before && delta ? ` (${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toLocaleString()} since ${date(before.t)}).` : '.'),
      h('ul', { class: 'bands' }, BANDS.map(([name, lvs]) => {
        const p = band(lvs);
        return h('li', null, h('span', { class: 'band-name' }, 'HSK ' + name), h('span', { class: 'band-bar' }, h('i', { class: p >= PASS ? 'pass' : '', style: { width: Math.max(2, p * 100) + '%' } })), h('span', { class: 'band-pct' }, pct(p)));
      })),
      gap == null ? null : h('p', { class: 'summary-note' }, `By ear: ${pct(r.listen)}. By eye, same bands: ${pct(r.readSame)}. `, insight),
      h('p', { class: 'summary-note' }, r.missed ? `${r.missed} missed words went into your Words deck, and new words there now start at ${bandName(r.frontier)}.` : `Nothing missed. New words in your deck now start at ${bandName(r.frontier)}.`),
      h('p', { class: 'summary-note small' }, 'An estimate from a sample, good to about half a band. It measures recognition, not speaking: a conversation debrief estimates that.'),
      fresh ? h('div', { class: 'actions' }, button(r.missed ? 'Review missed words' : 'Open the Words deck', 'primary', () => go('recall-words'), 'arrow'), button('Back to today', 'ghost', () => go('home'))) : null);
  }

  intro();
  return { el, title: '水平', sub: 'Level check · HSK vocabulary', back: 'home', destroy: () => { alive = false; document.removeEventListener('keydown', keydown); } };
}
