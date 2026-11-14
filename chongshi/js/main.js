// App shell: hash router, top sign, tabs, the guided "seated ride", and the settings sheet.
import { LINES, SCENES } from './content.gen.js';
import * as store from './store.js';
import { stop, speak, zhVoices, ttsStatus, sfx, keepAwake } from './audio.js';
import { h, zh, icon, go, button, toast } from './ui.js';
import { sceneView } from './scene.js';
import { recallView } from './recall.js';
import { gamesHub, gameView } from './games.js';
import { rideView } from './ride.js';
import { startJourney, journeyAt } from './journey.js';
import { levelView, levelSummary } from './level.js';
import { talkHub, talkView } from './talk.js';
import { apiKey, setApiKey } from './llm.js';
import { composeView } from './compose.js';
import { startSync } from './sync.js';

const $ = (id) => document.getElementById(id);
const lineOf = (scene) => LINES.find((l) => l.id === scene.line);
const lineNo = (scene) => LINES.findIndex((l) => l.id === scene.line) + 1;

/* ---------- views ---------- */
function pips(id) {
  const st = store.sceneState(id);
  return h('span', { class: 'pips', 'aria-label': store.STEPS.filter((s) => st[s]).length + ' of 4 steps done' },
    [['listen', '听'], ['check', '懂'], ['read', '读'], ['speak', '说']].map(([k, c]) => h('i', { class: st[k] ? 'on' : '', lang: 'zh-CN' }, c)));
}
function station(sc) {
  return h('button', { class: 'station l' + lineNo(sc), type: 'button', onclick: () => go('scene-' + sc.id) },
    h('span', { class: 'roundel' + (store.sceneDone(sc.id) ? ' full' : '') }),
    h('span', { class: 'station-name' }, zh(sc.zh), h('small', null, sc.en)),
    pips(sc.id));
}

function home() {
  const st = store.stats();
  const ns = store.nextScene();
  const seg = (k, label) => (st[k] ? h('i', { class: 'm-' + k, style: { flexGrow: st[k] }, title: `${st[k]} ${label}` }) : null);
  const legend = (k, zhLabel, label) => h('li', null, h('i', { class: 'm-' + k }), h('b', null, st[k]), h('span', { lang: 'zh-CN' }, zhLabel), ' ', label);

  const lvl = levelSummary();
  const ws = store.wordStats();
  const spoke = store.talks()[store.talks().length - 1];
  const band = (l) => (l >= 7 ? 'HSK 7–9' : l <= 2 ? 'Below HSK 3' : 'HSK ' + l);

  // The last eight weeks, one column per week, Monday at the top.
  const t0 = store.today();
  const monday = t0 - ((new Date().getDay() + 6) % 7);
  const days = store.activeDays();
  const weeks = Array.from({ length: 8 }, (_, w) => h('span', null, Array.from({ length: 7 }, (_, d) => {
    const day = monday - (7 - w) * 7 + d;
    return h('i', { class: day > t0 ? 'future' : days[day] ? 'on' : '' });
  })));
  const fresh = !lvl && !st.km;

  const el = h('div', { class: 'page' },
    fresh ? h('section', { class: 'panel welcome' },
      h('h2', null, h('span', { lang: 'zh-CN' }, '欢迎回来'), ' Welcome back to Mandarin'),
      h('p', null, 'It is still in there. Start with the six-minute level check so the app knows where your gaps are, then take a seated ride.'),
      h('div', { class: 'actions' }, button('Take the level check', 'primary', () => go('level'), 'arrow'))) : null,
    h('section', { class: 'board', 'aria-label': 'Start a ride' },
      h('div', { class: 'board-head' }, h('span', { lang: 'zh-CN' }, '今日班次'), h('span', null, 'Today’s departures')),
      h('button', { class: 'dep', type: 'button', onclick: () => go('ride') },
        icon('phones'),
        h('span', { class: 'dep-name' }, h('b', { lang: 'zh-CN' }, '耳机模式'), h('span', null, 'Ears-only ride')),
        h('span', { class: 'dep-info' }, 'Listen, answer aloud, shadow. No screen needed.'),
        h('span', { class: 'dep-go' }, icon('arrow'))),
      h('button', { class: 'dep', type: 'button', onclick: startJourney },
        icon('seat'),
        h('span', { class: 'dep-name' }, h('b', { lang: 'zh-CN' }, '坐着学'), h('span', null, 'Seated ride')),
        h('span', { class: 'dep-info' }, h('span', { lang: 'zh-CN' }, ns.zh), st.due ? `, then puzzles, then Recall (${st.due} due).` : ', then puzzles, then Recall.'),
        h('span', { class: 'dep-go' }, icon('arrow'))),
      h('button', { class: 'dep', type: 'button', onclick: () => go('talk') },
        icon('mic'),
        h('span', { class: 'dep-name' }, h('b', { lang: 'zh-CN' }, '对话'), h('span', null, 'Live conversation')),
        h('span', { class: 'dep-info' }, 'Talk with Claude as a student, a parent or an alum.'),
        h('span', { class: 'dep-go' }, icon('arrow')))),

    h('section', { class: 'stats' },
      h('div', null, h('span', { class: 'stat-k' }, h('span', { lang: 'zh-CN' }, '本周'), ' This week'),
        h('span', { class: 'punch', 'aria-label': `${st.week} of 3 rides this week` }, [0, 1, 2].map((i) => h('i', { class: i < st.week ? 'on' : '' })), st.week > 3 ? h('small', null, '+' + (st.week - 3)) : null)),
      h('div', null, h('span', { class: 'stat-k' }, h('span', { lang: 'zh-CN' }, '里程'), ' Distance'), h('span', { class: 'stat-v' }, st.km, h('small', null, ' km'))),
      h('div', null, h('span', { class: 'stat-k' }, h('span', { lang: 'zh-CN' }, '到期'), ' Due now'), h('span', { class: 'stat-v' }, st.due + ws.due))),

    h('section', { class: 'panel' },
      h('h2', null, h('span', { lang: 'zh-CN' }, '水平'), ' Your level'),
      lvl
        ? h('div', { class: 'level-row' }, h('b', null, band(lvl.level)), h('span', null, `about ${lvl.vocab.toLocaleString()} words by recognition`, spoke ? ` · speaking ${spoke.level}` : ''))
        : h('p', null, 'Not measured yet. Six minutes shows how much is still there and where the gaps begin.'),
      h('div', { class: 'actions' },
        button(lvl ? 'Check again' : 'Take the level check', lvl || fresh ? 'ghost' : 'primary', () => go('level')),
        button(ws.due ? `Words deck · ${ws.due} due` : 'Words deck', 'ghost', () => go('recall-words')))),

    h('section', { class: 'panel' },
      h('h2', null, h('span', { lang: 'zh-CN' }, '回暖'), ' What’s coming back'),
      h('div', { class: 'meter', role: 'img', 'aria-label': `${st.solid} solid, ${st.warm} warming, ${st.rusty} rusty, ${st.new} untouched of ${st.total} phrases` },
        seg('solid', 'solid'), seg('warm', 'warming'), seg('rusty', 'rusty'), seg('new', 'untouched')),
      h('ul', { class: 'legend' }, legend('solid', '熟练', 'solid'), legend('warm', '回暖', 'warming up'), legend('rusty', '生疏', 'rusty'), legend('new', '未碰', 'untouched')),
      h('div', { class: 'weeks-row' }, h('div', { class: 'weeks', role: 'img', 'aria-label': `Practice days over the last eight weeks: ${Object.keys(days).filter((d) => +d > t0 - 56).length}` }, weeks), h('span', null, 'Days you practised, last 8 weeks'))),

    h('section', { class: 'panel' },
      h('h2', null, h('span', { lang: 'zh-CN' }, '下一站'), ' Next station'),
      h('div', { class: 'next-line l' + lineNo(ns) }, h('span', { class: 'line-tag' }, lineNo(ns)), h('span', null, zh(lineOf(ns).zh), ' ', lineOf(ns).en)),
      station(ns)));
  return { el, title: '重拾', sub: 'Chóngshí · pick it back up' };
}

function scenes() {
  const el = h('div', { class: 'page' }, LINES.map((l, i) =>
    h('section', { class: 'line l' + (i + 1) },
      h('h2', { class: 'line-head' }, h('span', { class: 'line-tag' }, i + 1), zh(l.zh), h('small', null, l.en)),
      h('div', { class: 'track' }, SCENES.filter((s) => s.line === l.id).map(station)))),
  h('section', { class: 'panel' },
    h('h2', null, h('span', { lang: 'zh-CN' }, '自编'), ' Need a different conversation?'),
    h('p', null, 'Name a situation from your work and Claude writes a new scene for it, at your level.'),
    h('div', { class: 'actions' }, button('Write me a new scene', 'ghost', () => go('compose'), 'arrow'))));
  return { el, title: '场景', sub: `Scenes · ${LINES.length} lines, ${SCENES.length} stations` };
}

const routes = {
  home,
  scenes,
  scene: sceneView,
  recall: recallView,
  games: gamesHub,
  game: gameView,
  ride: rideView,
  level: levelView,
  compose: composeView,
  talk: (arg) => (arg ? talkView(arg) : talkHub()),
};
const TABS = [['home', '今日', 'Today', 'home'], ['scenes', '场景', 'Scenes', 'scenes'], ['talk', '对话', 'Talk', 'mic'], ['recall', '复习', 'Recall', 'recall'], ['games', '游戏', 'Puzzles', 'games']];

let current = null;
let currentName = 'home';
let started = false;
let warned = false;
let synced = false;
function route() {
  const hash = location.hash.replace(/^#/, '') || 'home';
  const cut = hash.indexOf('-');
  const name = cut < 0 ? hash : hash.slice(0, cut);
  const arg = cut < 0 ? '' : hash.slice(cut + 1);
  const leg = journeyAt(hash);
  stop();
  keepAwake(false);
  current?.destroy?.();
  let view;
  try { view = (routes[name] || home)(arg); } catch (e) {
    // One broken screen must not take the app down with it.
    console.error(e);
    view = { el: h('div', { class: 'page' }, h('section', { class: 'panel' }, h('h2', null, 'This screen hit a problem'), h('p', null, 'Your progress is saved. Go back to Today, or reload the app.'), h('div', { class: 'actions' }, button('Back to today', 'primary', () => go('home')), button('Reload', 'ghost', () => location.reload())))), title: '重拾' };
  }
  current = view;
  currentName = name;
  document.body.classList.toggle('immersive', !!view.immersive);
  $('t-zh').textContent = view.title;
  $('t-en').textContent = view.sub || '';
  $('back').hidden = !view.back;
  $('back').onclick = () => go(view.back);
  $('leg').hidden = !leg;
  $('leg').textContent = leg;
  const tab = { scene: 'scenes', compose: 'scenes', game: 'games', level: 'home' }[name] || name;
  for (const a of document.querySelectorAll('#tabs a')) {
    a.classList.toggle('on', a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  $('view').replaceChildren(view.el);
  window.scrollTo(0, 0);
  if (started) $('view').focus({ preventScroll: true }); // screen readers land on the new screen, not the old button
  started = true;
  if (store.storageBroken() && !warned) { warned = true; toast('This browser is not saving progress. Private windows often block it.'); }
}

/* ---------- settings ---------- */
function openSettings() {
  const set = store.settings();
  const sheet = $('sheet');
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); };
  const toggle = (id, label, hint, key) => {
    const input = h('input', { type: 'checkbox', id, checked: set[key] || null, onchange: () => store.setSetting(key, input.checked) });
    return h('label', { class: 'row', for: id }, h('span', null, h('b', null, label), h('small', null, hint)), input);
  };
  const vs = zhVoices();
  const status = ttsStatus();
  const name = (v) => v.name.replace(/\s*\(.*\)/, '');
  const voiceTip = h('p', { class: 'note' }, 'Voices come from your device, and synthetic-sounding ones are already filtered out. For a more natural voice on iPhone, iPad or Mac, open Settings → Accessibility → Spoken Content (or Read & Speak) → Voices → Chinese, download an Enhanced or Premium voice, then reload this page.');
  const voiceRow = vs.length
    ? [h('div', { class: 'row' }, h('label', { for: 'voice' }, h('b', null, 'Mandarin voice'), h('small', null, 'Plays when you pick one.')),
      h('select', { id: 'voice', onchange: (e) => { store.setSetting('voice', e.target.value); speak('你好，咱们开始吧。'); } },
        vs.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === set.voice || null }, name(v))))),
    h('div', { class: 'row' }, h('label', { for: 'voice2' }, h('b', null, 'Other speaker'), h('small', null, 'The student in scenes, and Claude in conversation.')),
      h('select', { id: 'voice2', onchange: (e) => { store.setSetting('voice2', e.target.value); speak('老师好，我是不是来早了？', { alt: true }); } },
        h('option', { value: '', selected: !set.voice2 || null }, 'Automatic'),
        h('option', { value: 'same', selected: set.voice2 === 'same' || null }, 'Same voice'),
        vs.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === set.voice2 || null }, name(v))))),
    voiceTip]
    : h('p', { class: 'note' }, status === 'unknown'
      ? 'This browser has not listed its voices yet. Audio will use the system default Mandarin voice if there is one.'
      : 'No Mandarin voice is installed on this device, so audio is off. Add a Chinese (Mandarin) voice in your system’s speech or text-to-speech settings, then reload.');

  const code = h('textarea', { id: 'backup-code', rows: 3, placeholder: 'Paste a progress code here to restore it', 'aria-label': 'Progress code' });
  const armed = { v: false };
  const resetBtn = button('Reset progress', 'ghost danger', () => {
    if (!armed.v) { armed.v = true; resetBtn.lastChild.textContent = 'Tap again to erase everything'; return; }
    store.reset();
    close();
    toast('Progress erased');
    route();
  });

  sheet.replaceChildren(h('div', { class: 'sheet-card', role: 'dialog', 'aria-label': 'Settings' },
    h('div', { class: 'sheet-head' }, h('h2', null, h('span', { lang: 'zh-CN' }, '设置'), ' Settings'), h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    voiceRow,
    toggle('set-slow', 'Slower speech', 'Plays Chinese at 0.8×. Leave off once your ear is back.', 'slow'),
    toggle('set-sfx', 'Chimes and haptics', 'Sound and vibration on taps and answers.', 'sfx'),
    apiKey() ? h('div', { class: 'row' }, h('span', null, h('b', null, 'Claude API key'), h('small', null, 'Saved in this browser for live conversation.')), button('Remove', 'chip', () => { setApiKey(''); close(); toast('API key removed'); })) : null,
    h('h3', null, synced ? 'Progress across devices' : 'Move progress between devices'),
    h('p', { class: 'note' }, synced
      ? 'Progress syncs to your Claude account: open this page on another device and it is there. The code below is a manual backup.'
      : 'Progress is saved in this browser only. Copy the code on one device and restore it on the other. Opened from its claude.ai page, the app syncs by itself.'),
    code,
    h('div', { class: 'actions' },
      button('Copy my code', 'ghost', async () => {
        code.value = store.exportCode();
        code.select();
        try { await navigator.clipboard.writeText(code.value); toast('Code copied'); } catch { toast('Code selected. Copy it from the box.'); }
      }),
      button('Restore from code', 'ghost', () => {
        if (!code.value.trim()) return toast('Paste a code first');
        if (store.importCode(code.value)) { close(); applyPinyin(); toast('Progress restored'); route(); } else toast('That code could not be read');
      })),
    h('h3', null, 'How it works'),
    h('p', { class: 'note' }, 'You are relearning, not learning. Every exercise makes you produce the Chinese before you see it, at natural speed, in a sentence a student might actually say. Phrases you still know are pushed weeks out after one look. The ones that have gone missing come back tomorrow.'),
    resetBtn));
  sheet.hidden = false;
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
}

function applyPinyin() {
  const on = !!store.settings().py;
  document.documentElement.classList.toggle('py-on', on);
  $('py').setAttribute('aria-pressed', on);
}

/* ---------- boot ---------- */
function boot() {
  $('tabs').replaceChildren(...TABS.map(([hash, z, en, ic]) =>
    h('a', { href: '#' + hash, 'data-tab': hash }, icon(ic), h('b', { lang: 'zh-CN' }, z), h('span', null, en))));
  $('py').onclick = () => { store.setSetting('py', !store.settings().py); applyPinyin(); sfx('tap'); };
  $('gear').onclick = openSettings;
  applyPinyin();
  window.addEventListener('hashchange', route);
  route();
  store.annotateScenes(() => { if (currentName === 'scene') route(); });
  // On its claude.ai page the app keeps progress in step across devices; a pull redraws list screens only,
  // never an exercise in progress.
  startSync(() => {
    applyPinyin();
    store.annotateScenes();
    if (['home', 'scenes', 'games', 'talk', 'level'].includes(currentName)) route();
    toast('Progress updated from your other device');
  }).then((on) => { synced = on; });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('A new version is ready. Reload to use it.'); });
  }
}
boot();
