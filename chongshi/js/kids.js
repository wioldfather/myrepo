// 一起学: Kai and Swae's side of the app. Built for children under eight who cannot read yet, playing on a
// parent's device with the parent beside them. Everything is hear-and-do: no text is needed to play.
//   找一找  hear a word, tap its picture (two choices at first, then three, then four)
//   配对    memory pairs; every card says its word when turned
//   动一动  hear an action and do it
//   家里说  the phrases the grown-up says through the day, which matter more than any game
// With both children playing, turns alternate. Nothing is ever marked wrong; a miss just plays the word again.
import { KIDS } from './content.gen.js';
import * as store from './store.js';
import { speak, stop, sfx } from './audio.js';
import { h, fill, zh, icon, go, button, sleep } from './ui.js';

const say = (text) => speak(text, { rate: 0.85 });
const COLORS = ['var(--l3)', 'var(--l1)'];
let who = 2; // 0 or 1 for one child, 2 for both taking turns

const pic = (w, cls = '') => (w.pic[0] === '#'
  ? h('span', { class: 'kpic swatch ' + cls, style: { background: w.pic } })
  : h('span', { class: 'kpic ' + (/^\d+$/.test(w.pic) ? 'num ' : '') + cls, 'aria-hidden': 'true' }, w.pic));
const players = () => (who === 2 ? [0, 1] : [who]);
const tile = (hash, emoji, zhLabel, label) => h('button', { type: 'button', onclick: () => go(hash) }, h('span', { class: 'kpic' }, emoji), h('b', { lang: 'zh-CN' }, zhLabel), h('small', null, label));
// Every word a current player has found at least once, for the mixed review.
const metWords = () => KIDS.sets.filter((st) => !st.read).flatMap((st) => st.words).filter((w) => players().some((i) => store.kids().p[i].w[w.zh]));
const mixSet = () => ({ id: 'mix', zh: '混一混', en: 'Mix-up', pic: '🎲', words: store.shuffle(metWords()).slice(0, 12) });
const top = (title, back) => h('div', { class: 'ktop' },
  h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Back', onclick: () => go(back) }, icon(back === 'home' ? 'x' : 'back')), h('b', { lang: 'zh-CN' }, title));

function turnBadge(i) {
  return h('div', { class: 'kturn', style: { background: COLORS[i] } }, store.kids().names[i]);
}
function cheer(el, stars, then, againLabel, again) {
  sfx('done');
  say('真棒！');
  const k = store.kids();
  fill(el, top('真棒！', 'kids'),
    h('div', { class: 'kcheer' },
      h('div', { class: 'kstars', 'aria-hidden': 'true' }, '⭐'.repeat(Math.min(5, Math.max(1, stars)))),
      h('p', { class: 'kbig', lang: 'zh-CN' }, '真棒！'),
      h('p', null, players().map((i) => k.names[i]).join(' and ') + (stars === 1 ? ' earned a star.' : ` earned ${stars} stars.`)),
      then ? h('p', { class: 'knew' }, then) : null,
      h('div', { class: 'actions' }, button(againLabel, 'primary', again, 'again'), button('Pick something else', 'ghost', () => go('kids')))));
}

/* ---------- hub ---------- */
export function kidsHub() {
  const el = h('div', { class: 'kids' });
  function paint() {
    const k = store.kids();
    const train = (i) => h('div', { class: 'ktrain' },
      h('button', { class: 'kname', type: 'button', style: { background: COLORS[i] }, 'aria-label': 'Rename ' + k.names[i], onclick: () => rename(i) }, k.names[i]),
      h('span', { class: 'kcars', 'aria-label': `${KIDS.sets.filter((s) => store.kidKnows(i, s)).length} sets known` }, '🚂', KIDS.sets.filter((s) => store.kidKnows(i, s)).map((s) => h('i', null, s.pic))),
      h('span', { class: 'kstar' }, '⭐ ' + k.p[i].stars));
    fill(el, top('一起学', 'home'),
      h('div', { class: 'kwho', role: 'group', 'aria-label': 'Who is playing' }, [[0, k.names[0]], [1, k.names[1]], [2, 'Both']].map(([v, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(who === v), onclick: () => { who = v; sfx('tap'); paint(); } }, label))),
      train(0), train(1),
      h('div', { class: 'kgames three' },
        tile('kids-stories', '📖', '故事', 'Bedtime stories'),
        tile('kids-songs', '🎵', '唱一唱', 'Sing together'),
        tile('kids-move', '🤸', '动一动', 'Hear it, do it'),
        tile('kids-hunt', '🔍', '寻宝', 'Treasure hunt'),
        metWords().length >= 6 ? tile('kids-set-mix', '🎲', '混一混', 'Words you know') : null,
        tile('kids-home', '🏠', '家里说', 'For the grown-up')),
      h('details', { class: 'ktips' }, h('summary', null, 'For the grown-up: how to get the most from this'),
        h('ul', { class: 'bullets' },
          h('li', null, 'Play it with them. Children learn more from an app used with a parent than alone, so say each word with them and talk about the picture.'),
          h('li', null, 'Keep it to five or ten minutes, and stop while it is still fun.'),
          h('li', null, 'Come back to old sets. 混一混 mixes words they have already met, which is what makes them stick.'),
          h('li', null, 'Use the words away from the screen: 家里说 at breakfast and bedtime, 寻宝 around the house.'))),
      h('p', { class: 'khint' }, 'Pick a picture set. First you meet the words, then you find them.'),
      h('div', { class: 'ksets' }, KIDS.sets.map((s) => h('button', { type: 'button', class: players().every((i) => store.kidKnows(i, s)) ? 'known' : '', onclick: () => go('kids-set-' + s.id) },
        pic(s), h('b', { lang: 'zh-CN' }, s.zh), h('small', null, s.en)))));
  }
  function rename(i) {
    const input = h('input', { id: 'kid-name', type: 'text', value: store.kids().names[i], maxlength: 12, 'aria-label': 'Name' });
    const easy = h('input', { type: 'checkbox', id: 'kid-easy', checked: store.kids().p[i].easy || null });
    fill(el, top('一起学', 'kids'), h('div', { class: 'kcheer' }, h('p', null, 'What should this player be called?'), input,
      h('label', { class: 'row', for: 'kid-easy' }, h('span', null, h('b', null, 'Easier rounds'), h('small', null, 'Two pictures to choose from, then three. For a younger child.')), easy),
      h('div', { class: 'actions' }, button('Save', 'primary', () => { store.kidName(i, input.value); store.kidEasy(i, easy.checked); paint(); }), button('Cancel', 'ghost', paint))));
    input.focus();
  }
  paint();
  return { el, title: '一起学', immersive: true, light: true };
}

/* ---------- a set: meet the words, then choose a game ---------- */
function setView(id) {
  const set = id === 'mix' ? mixSet() : KIDS.sets.find((s) => s.id === id);
  if (!set || !set.words.length) return kidsHub();
  const el = h('div', { class: 'kids' });
  let alive = true;
  let turn = players()[0];
  const nextTurn = () => { const ps = players(); turn = ps[(ps.indexOf(turn) + 1) % ps.length]; };

  // 学: one picture at a time. The word plays twice; the child says it; the grown-up moves on.
  function meet(i = 0) {
    const w = set.words[i];
    if (!w) return menu();
    fill(el, top(set.zh, 'kids'), turnBadge(turn),
      h('button', { class: 'kcard', type: 'button', 'aria-label': 'Hear it again', onclick: () => say(w.zh) }, pic(w, 'huge'), zh(w.zh, { cls: 'kword' }), h('small', null, w.en)),
      h('p', { class: 'khint' }, 'Listen, then say it together.'),
      h('div', { class: 'actions' }, button(i < set.words.length - 1 ? 'Next' : 'Now play', 'primary big', () => { stop(); nextTurn(); meet(i + 1); }, 'arrow')));
    say(w.zh).then((ok) => alive && ok && sleep(500).then(() => alive && el.contains(document.querySelector('.kcard')) && say(w.zh)));
  }
  function menu() {
    fill(el, top(set.zh, 'kids'),
      h('div', { class: 'kcheer' }, pic(set, 'huge'),
        h('div', { class: 'kgames' },
          h('button', { type: 'button', onclick: () => find() }, h('span', { class: 'kpic' }, '👆'), h('b', { lang: 'zh-CN' }, '找一找'), h('small', null, 'Find the picture')),
          h('button', { type: 'button', onclick: () => match() }, h('span', { class: 'kpic' }, '🃏'), h('b', { lang: 'zh-CN' }, '配对'), h('small', null, 'Match the pairs'))),
        h('div', { class: 'actions' }, button('Meet the words again', 'ghost', () => meet(0)))));
  }

  // 找一找
  function find() {
    const queue = store.shuffle(set.words).slice(0, 8);
    let n = 0;
    let stars = 0;
    const before = players().map((i) => store.kidKnows(i, set));
    function round() {
      const w = queue[n];
      if (!w) {
        players().forEach((i) => store.kidStar(i, 1));
        store.markDay();
        const fresh = players().filter((i, k) => !before[k] && store.kidKnows(i, set));
        return cheer(el, 1, fresh.length ? `${fresh.map((i) => store.kids().names[i]).join(' and ')} added ${set.pic} to the train!` : null, 'Play again', find);
      }
      const easy = store.kids().p[turn].easy;
      const size = Math.min(set.words.length, easy ? (n < 4 ? 2 : 3) : n < 2 ? 2 : n < 5 ? 3 : 4);
      const options = store.shuffle([w, ...store.shuffle(set.words.filter((x) => x !== w)).slice(0, size - 1)]);
      let locked = false;
      const tiles = options.map((o) => h('button', { class: 'ktile', type: 'button', 'aria-label': o.en, 'data-word': o.zh, onclick: async () => {
        if (locked) return;
        if (o !== w) { tiles[options.indexOf(o)].classList.add('wobble'); sfx('lift'); say(w.zh); setTimeout(() => tiles[options.indexOf(o)].classList.remove('wobble'), 500); return; }
        locked = true;
        tiles[options.indexOf(o)].classList.add('yes');
        sfx('good');
        store.kidFound(turn, w.zh);
        stars++;
        await say(w.zh);
        await sleep(350);
        if (!alive) return;
        n++;
        nextTurn();
        round();
      } }, pic(o, 'big')));
      fill(el, top(set.zh, 'kids'), turnBadge(turn),
        h('button', { class: 'khear' + (set.read ? ' nopy' : ''), type: 'button', 'aria-label': 'Hear it', onclick: () => say(w.zh) }, icon('sound'), zh(w.zh, { cls: 'kword' })),
        set.read ? h('p', { class: 'khint' }, 'Read it first. Tap the speaker to check.') : null,
        h('div', { class: 'ktiles n' + size }, tiles),
        h('div', { class: 'kdots', 'aria-hidden': 'true' }, queue.map((_, i) => h('i', { class: i < n ? 'on' : '' }))));
      if (!set.read) say(w.zh);
    }
    round();
  }

  // 配对
  function match() {
    const words = store.shuffle(set.words).slice(0, 6);
    const cards = store.shuffle([...words, ...words].map((w, i) => ({ w, i, up: false, gone: false })));
    const score = [0, 0];
    let open = [];
    let busy = false;
    function paint() {
      fill(el, top(set.zh, 'kids'), turnBadge(turn),
        h('div', { class: 'kgrid' }, cards.map((c) => h('button', { class: 'kflip' + (c.up || c.gone ? ' up' : '') + (c.gone ? ' gone' : ''), type: 'button', 'aria-label': c.up || c.gone ? c.w.en : 'Card', disabled: c.gone || null, onclick: () => flip(c) }, c.up || c.gone ? pic(c.w) : h('span', { class: 'kback' }, '?')))),
        who === 2 ? h('p', { class: 'khint' }, `${store.kids().names[0]} ${score[0]} · ${store.kids().names[1]} ${score[1]}`) : null);
    }
    async function flip(c) {
      if (busy || c.up || c.gone) return;
      c.up = true;
      open.push(c);
      sfx('tap');
      paint();
      say(c.w.zh);
      if (open.length < 2) return;
      busy = true;
      await sleep(900);
      if (!alive) return;
      const [a, b] = open;
      open = [];
      if (a.w === b.w) {
        a.gone = b.gone = true;
        score[turn]++;
        store.kidFound(turn, a.w.zh);
        sfx('good');
      } else {
        a.up = b.up = false;
        nextTurn();
      }
      busy = false;
      if (cards.every((x) => x.gone)) {
        players().forEach((i) => store.kidStar(i, 1));
        store.markDay();
        return cheer(el, 1, null, 'Play again', match);
      }
      paint();
    }
    paint();
  }

  const fresh = id !== 'mix' && players().some((i) => !set.words.some((w) => store.kids().p[i].w[w.zh]));
  if (fresh) meet(0); else menu();
  return { el, title: set.zh, immersive: true, light: true, destroy: () => { alive = false; stop(); } };
}

/* ---------- 动一动 ---------- */
function moveView() {
  const el = h('div', { class: 'kids' });
  let alive = true;
  function run() {
    const queue = store.shuffle(KIDS.actions).slice(0, 8);
    let n = 0;
    async function round() {
      const a = queue[n];
      if (!a) { players().forEach((i) => store.kidStar(i, 1)); store.markDay(); return cheer(el, 1, null, 'Again', run); }
      const reveal = h('span', { class: 'kpic huge hidden' }, a.pic);
      fill(el, top('动一动', 'kids'),
        h('button', { class: 'kcard', type: 'button', 'aria-label': 'Hear it again', onclick: () => say(a.zh + '！') }, reveal, zh(a.zh, { cls: 'kword' }), h('small', null, a.en)),
        h('p', { class: 'khint' }, 'Listen and do it! The picture shows after a moment.'),
        h('div', { class: 'actions' }, button('做到了 · Did it!', 'primary big', () => { stop(); sfx('good'); n++; round(); }, 'check')),
        h('div', { class: 'kdots', 'aria-hidden': 'true' }, queue.map((_, i) => h('i', { class: i < n ? 'on' : '' }))));
      await say(a.zh + '！');
      await sleep(1600);
      if (alive) reveal.classList.remove('hidden');
    }
    round();
  }
  run();
  return { el, title: '动一动', immersive: true, light: true, destroy: () => { alive = false; stop(); } };
}

/* ---------- 家里说 ---------- */
function homeView() {
  const el = h('div', { class: 'kids' });
  function paint() {
    const said = store.kids().said;
    fill(el, top('家里说', 'kids'),
      h('p', { class: 'khint wide' }, 'Children pick up a language from hearing it used, not from drills. Choose one routine and say it in Mandarin every day this week. Tap a line to hear it; tick it when you have used it for real.'),
      KIDS.home.map((r) => h('section', { class: 'kroutine' },
        h('h2', null, h('span', { lang: 'zh-CN' }, r.zh), ' ' + r.en),
        r.lines.map((l) => h('div', { class: 'kline' },
          h('button', { class: 'kline-say', type: 'button', onclick: () => say(l.zh) }, zh(l.zh), h('small', null, l.en)),
          h('button', { class: 'ktick' + (said[l.zh] ? ' on' : ''), type: 'button', 'aria-label': 'I said this today', onclick: () => { store.homeSaid(l.zh); sfx('good'); paint(); } }, icon('check'), said[l.zh] ? h('i', null, said[l.zh]) : null))))));
  }
  paint();
  return { el, title: '家里说', immersive: true, light: true, destroy: stop };
}

/* ---------- 寻宝: run and find it ---------- */
function huntView() {
  const el = h('div', { class: 'kids' });
  let alive = true;
  let turn = players()[0];
  function run() {
    const queue = store.shuffle(KIDS.hunt).slice(0, 8);
    let n = 0;
    async function round() {
      const q = queue[n];
      if (!q) { players().forEach((i) => store.kidStar(i, 1)); store.markDay(); return cheer(el, 1, null, 'Again', run); }
      const reveal = h('span', { class: 'kpic huge hidden' }, q.pic);
      fill(el, top('寻宝', 'kids'), turnBadge(turn),
        h('button', { class: 'kcard', type: 'button', 'aria-label': 'Hear it again', onclick: () => say(q.zh) }, reveal, zh(q.zh, { cls: 'kword small' }), h('small', null, q.en)),
        h('p', { class: 'khint' }, 'Off they go! The picture is a clue if they need one.'),
        h('div', { class: 'actions' }, button('找到了 · Found it!', 'primary big', () => { stop(); sfx('good'); n++; const ps = players(); turn = ps[(ps.indexOf(turn) + 1) % ps.length]; round(); }, 'check')),
        h('div', { class: 'kdots', 'aria-hidden': 'true' }, queue.map((_, i) => h('i', { class: i < n ? 'on' : '' }))));
      await say(q.zh);
      await sleep(2500);
      if (alive) reveal.classList.remove('hidden');
    }
    round();
  }
  run();
  return { el, title: '寻宝', immersive: true, light: true, destroy: () => { alive = false; stop(); } };
}

/* ---------- 故事: bedtime picture stories ---------- */
function storiesView(arg) {
  const el = h('div', { class: 'kids' });
  let alive = true;
  const story = KIDS.stories[arg];
  function list() {
    fill(el, top('故事', 'kids'),
      h('p', { class: 'khint wide' }, 'One picture and one sentence a page. Read it to them, or let the voice read and say it together.'),
      h('div', { class: 'ksets two' }, KIDS.stories.map((st, i) => h('button', { type: 'button', onclick: () => go('kids-stories-' + i) }, h('span', { class: 'kpic' }, st.pic), h('b', { lang: 'zh-CN' }, st.zh), h('small', null, st.en)))));
  }
  function page(i) {
    const pg = story.pages[i];
    if (!pg) return end();
    fill(el, top(story.zh, 'kids-stories'),
      h('button', { class: 'kcard story', type: 'button', 'aria-label': 'Hear it again', onclick: () => say(pg.zh) }, h('span', { class: 'kpic huge' }, pg.pic), zh(pg.zh, { cls: 'kword small' }), h('small', null, pg.en)),
      h('div', { class: 'actions' }, button(i < story.pages.length - 1 ? 'Next page' : 'The end', 'primary big', () => { stop(); page(i + 1); }, 'arrow')),
      h('div', { class: 'kdots', 'aria-hidden': 'true' }, story.pages.map((_, k) => h('i', { class: k <= i ? 'on' : '' }))));
    say(pg.zh);
  }
  function end() {
    players().forEach((i) => store.kidStar(i, 1));
    store.markDay();
    const answer = h('p', { class: 'knew', hidden: true }, zh(story.ask.pic));
    fill(el, top(story.zh, 'kids-stories'),
      h('div', { class: 'kcheer' }, h('div', { class: 'kstars', 'aria-hidden': 'true' }, '🌙'),
        h('p', { class: 'khint wide' }, 'Ask them:'),
        h('button', { class: 'kcard', type: 'button', onclick: () => say(story.ask.zh) }, zh(story.ask.zh, { cls: 'kword small' }), h('small', null, story.ask.en)),
        answer,
        h('div', { class: 'actions' }, button('Show the answer', 'ghost', () => { answer.hidden = false; say(story.ask.pic); }), button('Read it again', 'ghost', () => page(0), 'again'), button('晚安 · Good night', 'primary', () => go('kids')))));
  }
  if (story) page(0); else list();
  return { el, title: '故事', immersive: true, light: true, destroy: () => { alive = false; stop(); } };
}

/* ---------- 唱一唱: songs to tunes the grown-up knows ---------- */
function songsView(arg) {
  const el = h('div', { class: 'kids' });
  let alive = true;
  let playing = 0;
  const song = KIDS.songs[arg];
  function list() {
    fill(el, top('唱一唱', 'kids'),
      h('p', { class: 'khint wide' }, 'You know these tunes already, so you do the singing. Tap a line to hear how it is said.'),
      h('div', { class: 'ksets two' }, KIDS.songs.map((sg, i) => h('button', { type: 'button', onclick: () => go('kids-songs-' + i) }, h('span', { class: 'kpic' }, sg.pic), h('b', { lang: 'zh-CN' }, sg.zh), h('small', null, sg.tune)))));
  }
  function show() {
    const rows = song.lines.map((l) => h('button', { class: 'kline-say', type: 'button', onclick: () => { playing++; say(l.zh); } }, zh(l.zh), h('small', null, l.en)));
    async function all() {
      const mine = ++playing;
      for (const [i, l] of song.lines.entries()) {
        rows.forEach((r, k) => r.classList.toggle('now', k === i));
        await say(l.zh);
        if (!alive || mine !== playing) break;
      }
      rows.forEach((r) => r.classList.remove('now'));
    }
    fill(el, top(song.zh, 'kids-songs'),
      h('p', { class: 'khint wide' }, 'Sing it to the tune of ', h('b', null, song.tune), '.'),
      h('section', { class: 'kroutine' }, rows.map((r) => h('div', { class: 'kline' }, r))),
      h('div', { class: 'actions' }, button('Hear every line', 'ghost', all, 'play'), button('We sang it!', 'primary', () => { playing++; stop(); players().forEach((i) => store.kidStar(i, 1)); store.markDay(); cheer(el, 1, null, 'Sing it again', show); }, 'check')));
  }
  if (song) show(); else list();
  return { el, title: '唱一唱', immersive: true, light: true, destroy: () => { alive = false; stop(); } };
}

export function kidsView(arg) {
  if (arg === 'move') return moveView();
  if (arg === 'hunt') return huntView();
  const pick = arg && arg.match(/^(stories|songs)(?:-(\d+))?$/);
  if (pick) return (pick[1] === 'stories' ? storiesView : songsView)(pick[2] === undefined ? -1 : +pick[2]);
  if (arg === 'home') return homeView();
  if (arg && arg.startsWith('set-')) return setView(arg.slice(4));
  return kidsHub();
}
