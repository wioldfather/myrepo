// Puzzles. Four games share one runner and one tile board:
//   听写 dictation   hear a phrase at full speed, rebuild it from character tiles (homophones as decoys)
//   连句 weave       put the pieces of a sentence in native order
//   成语 idiom       find the four characters a sentence is missing
//   分寸 register    three ways to say it; pick the one that fits the moment
import { CHENGYU, REGISTER } from './content.gen.js';
import * as store from './store.js';
import { speak, stop, sfx, canSpeak, homophones } from './audio.js';
import { h, fill, zh, icon, go, button, sayButton, strip, summary, isHan, pinyinOf } from './ui.js';
import { wayOut } from './journey.js';

const GAMES = {
  dictation: { zh: '听写', en: 'Dictation tiles', blurb: 'Hear it at full speed. Rebuild it one character at a time.', skill: 'Ear to character', n: 8 },
  weave: { zh: '连句', en: 'Sentence weave', blurb: 'Put the pieces in the order a native speaker would.', skill: 'Word order', n: 8 },
  chengyu: { zh: '成语', en: 'Idiom match', blurb: 'Find the four-character idiom the sentence is missing.', skill: 'Idioms in context', n: 8 },
  register: { zh: '分寸', en: 'Read the room', blurb: 'Three ways to say it. Pick the one that fits.', skill: 'Tact and register', n: 6 },
  mix: { zh: '混合', en: 'Mixed run', blurb: 'Two of each, shuffled.', skill: 'Everything', n: 8 },
};

export function gamesHub() {
  const card = (key) => {
    const g = GAMES[key];
    return h('button', { class: 'game-card', type: 'button', onclick: () => go('game-' + key) },
      h('span', { class: 'game-tile', lang: 'zh-CN' }, g.zh),
      h('span', { class: 'game-text' }, h('b', null, g.en), h('span', null, g.blurb)),
      h('span', { class: 'game-best' }, store.best(key) ? `Best ${store.best(key)}/${g.n}` : g.skill));
  };
  const el = h('div', { class: 'page' }, h('div', { class: 'game-list' }, Object.keys(GAMES).map(card)));
  return { el, title: '游戏', sub: 'Puzzles · short runs, real phrases' };
}

function buildRounds(type) {
  const of = (t, items) => items.map((item) => ({ t, item }));
  const speakable = (n) => store.pickChunks(n + 4).filter((c) => [...c.zh].filter(isHan).length <= 14).slice(0, n);
  const weavable = (n) => store.pickChunks(n + 4).filter((c) => c.ex.length >= 3).slice(0, n); // phrases kept from conversations have no sentence to weave
  switch (type) {
    case 'dictation': return of('dictation', speakable(8));
    case 'weave': return of('weave', weavable(8));
    case 'chengyu': return of('chengyu', store.pickSpaced(CHENGYU, 8));
    case 'register': return of('register', store.pickSpaced(REGISTER, 6));
    default: {
      const d = of('dictation', speakable(2));
      const w = of('weave', weavable(4).filter((c) => !d.some((r) => r.item === c)).slice(0, 2));
      const y = of('chengyu', store.pickSpaced(CHENGYU, 2));
      const r = of('register', store.pickSpaced(REGISTER, 2));
      return [0, 1].flatMap((i) => [d[i], w[i], y[i], r[i]]).filter(Boolean);
    }
  }
}

/* ---------- the tile board ----------
   layout: [{want}] slots and [{fixed}] punctuation. Tap a tile to drop it in the next gap, tap a slot to
   take it back. When every gap is full the board checks itself: right tiles lock, wrong ones bounce home. */
function board({ layout, decoys, line, onSolved }) {
  const slots = layout.map((l) => ({ ...l, tile: null, locked: false }));
  const gaps = slots.filter((s) => !s.fixed);
  const tiles = store.shuffle([...gaps.map((s) => s.want), ...decoys]).map((t) => ({ t, used: false }));
  let mistakes = 0;
  let helped = 0;
  let over = false;
  const row = h('div', { class: 'slots' + (line ? ' flow' : ''), lang: 'zh-CN' });
  const bank = h('div', { class: 'bank' + (line ? ' flow' : ''), lang: 'zh-CN' });
  const el = h('div', { class: 'board-game' }, row, bank);

  function paint() {
    fill(row, ...slots.map((s) => (s.fixed
      ? h('span', { class: 'fixed' }, s.fixed)
      : h('button', { class: 'slot' + (s.tile ? ' filled' : '') + (s.locked ? ' ok' : '') + (s.bad ? ' bad' : ''), type: 'button', disabled: s.locked || !s.tile || over || null, 'aria-label': s.tile ? 'Remove ' + s.tile.t : 'Empty', onclick: () => lift(s) }, s.tile ? s.tile.t : ''))));
    fill(bank, ...tiles.map((t) => h('button', { class: 'tile' + (t.used ? ' used' : ''), type: 'button', disabled: t.used || over || null, onclick: () => place(t) }, t.t)));
  }
  function place(t) {
    const s = gaps.find((g) => !g.tile);
    if (!s || t.used) return;
    s.tile = t;
    t.used = true;
    sfx('tap');
    paint();
    if (gaps.every((g) => g.tile)) check();
  }
  function lift(s) {
    if (s.locked || !s.tile) return;
    s.tile.used = false;
    s.tile = null;
    sfx('lift');
    paint();
  }
  function check() {
    for (const g of gaps) {
      if (g.tile.t === g.want) g.locked = true;
      else g.bad = true;
    }
    if (gaps.every((g) => g.locked)) return solved(false);
    mistakes++;
    over = true;
    sfx('bad');
    paint();
    setTimeout(() => {
      over = false;
      for (const g of gaps) if (g.bad) { g.tile.used = false; g.tile = null; g.bad = false; }
      paint();
    }, 750);
  }
  function solved(revealed) {
    over = true;
    paint();
    row.classList.add('solved');
    onSolved({ mistakes, helped, revealed });
  }
  // Lock in the next correct tile.
  function hint() {
    if (over) return;
    const s = gaps.find((g) => !g.locked);
    if (!s) return;
    if (s.tile) { s.tile.used = false; s.tile = null; }
    let t = tiles.find((x) => !x.used && x.t === s.want);
    if (!t) {
      const holder = gaps.find((g) => !g.locked && g.tile && g.tile.t === s.want);
      t = holder.tile;
      holder.tile = null;
    }
    s.tile = t;
    t.used = true;
    s.locked = true;
    helped++;
    sfx('tap');
    paint();
    if (gaps.every((g) => g.locked)) solved(false);
    else if (gaps.every((g) => g.tile)) check();
  }
  function reveal() {
    if (over) return;
    for (const t of tiles) t.used = false;
    for (const g of gaps) {
      g.tile = tiles.find((x) => !x.used && x.t === g.want);
      g.tile.used = true;
      g.locked = true;
    }
    solved(true);
  }
  paint();
  return { el, hint, reveal };
}

const verdict = ({ mistakes, helped, revealed }) => ({ ok: !revealed, clean: !revealed && !mistakes && !helped });

/* ---------- rounds: each returns an element and calls done({ok, clean, detail}) once ---------- */
function dictation(c, done) {
  const layout = [];
  for (const ch of c.zh) {
    if (isHan(ch)) layout.push({ want: ch });
    else if (layout.length && layout[layout.length - 1].fixed) layout[layout.length - 1].fixed += ch;
    else layout.push({ fixed: ch });
  }
  const answer = new Set(layout.filter((l) => l.want).map((l) => l.want));
  const decoys = [];
  for (const ch of store.shuffle([...answer])) {
    if (decoys.length >= Math.min(5, Math.ceil(answer.size / 2) + 1)) break;
    const d = store.shuffle(homophones(ch)).find((x) => !answer.has(x) && !decoys.includes(x));
    if (d) decoys.push(d);
  }
  let helped = 0;
  const b = board({ layout, decoys, onSolved: (r) => {
    if (!r.revealed) speak(c.zh);
    done({ ...verdict({ ...r, helped: r.helped + helped }), detail: [zh(c.zh, { cls: 'big' }), h('p', { class: 'en' }, c.en), h('p', { class: 'chunk-note' }, c.note)] });
  } });
  const py = h('p', { class: 'pinyin', hidden: canSpeak() }, pinyinOf(c.zh));
  const pyBtn = button('Show pinyin', 'chip', () => { py.hidden = false; helped++; pyBtn.hidden = true; });
  pyBtn.hidden = !canSpeak();
  if (canSpeak()) speak(c.zh);
  return h('div', null,
    h('p', { class: 'ask' }, canSpeak() ? 'Build what you hear.' : 'No Mandarin voice on this device. Build it from the pinyin.'),
    canSpeak() ? h('div', { class: 'listen-row' },
      h('button', { class: 'bigplay', type: 'button', 'aria-label': 'Play again', onclick: () => speak(c.zh) }, icon('sound')),
      button('Slower', 'chip', () => speak(c.zh, { rate: 0.65 }))) : null,
    py, b.el,
    h('div', { class: 'helps' }, pyBtn, button('Place one for me', 'chip', b.hint), button('Give up', 'chip', b.reveal)));
}

function weave(c, done) {
  const full = c.ex.join('');
  const b = board({ layout: c.ex.map((want) => ({ want })), decoys: [], line: true, onSolved: (r) => {
    if (!r.revealed) speak(full);
    done({ ...verdict(r), detail: [h('div', { class: 'answer' }, zh(full), sayButton(full)), h('p', { class: 'en' }, c.exEn), h('p', { class: 'chunk-note' }, 'Built on ', h('span', { lang: 'zh-CN' }, c.zh), ' ', c.note)] });
  } });
  return h('div', null,
    h('p', { class: 'ask' }, 'Put it in order.'),
    h('p', { class: 'prompt-en' }, c.exEn),
    b.el,
    h('div', { class: 'helps' }, button('Place one for me', 'chip', b.hint), button('Give up', 'chip', b.reveal)));
}

function chengyu(y, done) {
  const others = store.shuffle(CHENGYU.filter((o) => o !== y)).slice(0, 2);
  const decoys = [...new Set(others.flatMap((o) => [...o.zh]))].filter((ch) => !y.zh.includes(ch)).slice(0, 8);
  let helped = 0;
  const filled = y.clue.replace('＿＿＿＿', y.zh);
  const b = board({ layout: [...y.zh].map((want) => ({ want })), decoys, onSolved: (r) => {
    if (!r.revealed) speak(y.zh);
    done({ ...verdict({ ...r, helped: r.helped + helped }), detail: [h('div', { class: 'answer' }, zh(y.zh, { cls: 'big' }), sayButton(y.zh)), h('p', { class: 'en' }, y.en, h('span', { class: 'lit' }, ' Literally: ' + y.lit + '.')), h('button', { class: 'example', type: 'button', onclick: () => speak(filled) }, h('span', { class: 'zh', lang: 'zh-CN' }, filled), h('span', { class: 'en' }, y.clueEn.replace('___', y.en)))] });
  } });
  const en = h('p', { class: 'prompt-en', hidden: true }, y.clueEn.replace('___', '「' + y.en + '」'));
  const enBtn = button('English hint', 'chip', () => { en.hidden = false; helped++; enBtn.hidden = true; });
  return h('div', null,
    h('p', { class: 'ask' }, 'Which idiom fills the gap?'),
    h('p', { class: 'clue' }, zh(y.clue)),
    en, b.el,
    h('div', { class: 'helps' }, enBtn, button('Place one for me', 'chip', b.hint), button('Give up', 'chip', b.reveal)));
}

function register(r, done) {
  const opts = store.shuffle(r.opts.map((o, i) => ({ ...o, best: i === 0 })));
  let chosen = false;
  const buttons = opts.map((o) => h('button', { class: 'opt', type: 'button', onclick: () => {
    if (chosen) return;
    chosen = true;
    buttons.forEach((b, k) => {
      b.disabled = true;
      if (opts[k].best) b.classList.add('ok');
      else if (opts[k] === o) b.classList.add('no');
      b.append(h('span', { class: 'fb' }, opts[k].fb));
    });
    speak(r.opts[0].zh);
    done({ ok: o.best, clean: o.best, detail: [] });
  } }, zh(o.zh)));
  return h('div', null, h('p', { class: 'ask' }, 'Which one fits?'), h('p', { class: 'situation' }, r.sit), h('div', { class: 'opts' }, buttons));
}

const ROUND = { dictation, weave, chengyu, register };

export function gameView(type) {
  if (!GAMES[type]) type = 'mix';
  const g = GAMES[type];
  const el = h('div', { class: 'page game' });
  let onEnter = null;
  const keydown = (e) => { if (e.key === 'Enter' && onEnter && !e.target.matches('button')) { e.preventDefault(); onEnter(); } };
  document.addEventListener('keydown', keydown);

  function run() {
    const rounds = buildRounds(type);
    let i = 0;
    let clean = 0;
    let solved = 0;
    let km = 0;
    let streak = 0;

    function show() {
      const { t, item } = rounds[i];
      const foot = h('div', { class: 'verdict', hidden: true });
      onEnter = null;
      const roundEl = ROUND[t](item, ({ ok, clean: wasClean, detail }) => {
        if (wasClean) clean++;
        if (ok) solved++;
        streak = wasClean ? streak + 1 : 0;
        const gain = (wasClean ? 3 : ok ? 1 : 0) + (streak >= 3 ? 1 : 0); // a run of clean answers pays a little extra
        km += gain;
        roundEl.querySelectorAll('.bank, .helps').forEach((x) => { x.hidden = true; });
        // Feed the result back into spacing: slips resurface in Recall; idioms and register items are scheduled here.
        if (t === 'dictation' || t === 'weave') { if (!wasClean) store.shake(item.id); } else store.rate(item.id, wasClean ? 1 : 0);
        sfx(wasClean ? 'good' : ok ? 'tap' : 'bad');
        const next = () => { stop(); if (++i < rounds.length) show(); else finish(); };
        onEnter = next;
        foot.className = 'verdict ' + (wasClean ? 'good' : ok ? 'mid' : 'bad');
        fill(foot, 
          h('div', { class: 'verdict-head' }, icon(ok ? 'check' : 'x'), h('b', null, wasClean ? '通过 · Clean' : ok ? 'Solved with help' : 'Missed this one'), streak >= 2 ? h('em', { class: 'streak', lang: 'zh-CN' }, '连对 ' + streak) : null, gain ? h('span', null, `+${gain} km`) : null),
          ...detail,
          h('div', { class: 'actions' }, button(i < rounds.length - 1 ? 'Next' : 'Finish', 'primary', next, 'arrow')));
        foot.hidden = false;
        foot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        foot.querySelector('.primary').focus({ preventScroll: true });
      });
      fill(el, 
        h('div', { class: 'run-head' }, strip(rounds.length, i), h('span', { class: 'run-kind', lang: 'zh-CN' }, GAMES[t].zh)),
        h('div', { class: 'round' }, roundEl),
        foot);
      window.scrollTo(0, 0);
    }

    function finish() {
      onEnter = null;
      store.addKm(km);
      store.setBest(type, clean);
      store.markDay();
      sfx('done');
      fill(el, summary({
        zhTitle: g.zh + ' 完成',
        title: g.en + ' complete',
        rows: [['Clean', `${clean} / ${rounds.length}`], ['Solved', `${solved} / ${rounds.length}`], ['Distance', `+${km} km`]],
        note: clean === rounds.length ? 'A clean run. 厉害！' : 'Anything you slipped on is queued to come back.',
        actions: wayOut('Another run', run),
      }));
      window.scrollTo(0, 0);
    }
    if (rounds.length) show(); else finish();
  }
  run();

  return { el, title: g.zh, sub: g.en, back: 'games', destroy: () => document.removeEventListener('keydown', keydown) };
}
