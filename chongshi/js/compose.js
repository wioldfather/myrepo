// 自编: Claude writes a new scene on a topic the learner names. The result has the same shape as an authored
// scene, so it runs through the same four steps, feeds Recall and the puzzles, and plays in the ears-only ride.
import * as store from './store.js';
import { backend, askJson, MESSAGES } from './llm.js';
import { h, go, button, toast } from './ui.js';

const IDEAS = [
  'A student asks whether a PhD is worth it',
  'Explaining how CPT and OPT work',
  'A student whose teammate takes credit for her analysis',
  'Catching up after the Mid-Autumn Festival',
  'A student deciding between consulting and tech',
];

const text = (v, max = 400) => String(v == null ? '' : v).trim().slice(0, max);

// Turn Claude's JSON into a scene, or return null if it is not usable.
export function toScene(r, id = 'g' + Date.now().toString(36)) {
  if (!r || !Array.isArray(r.lines) || !Array.isArray(r.chunks)) return null;
  const lines = r.lines.map((l) => ({ s: l && l.s === 'T' ? 'T' : 'S', zh: text(l && l.zh), en: text(l && l.en) })).filter((l) => l.zh && l.en);
  if (lines.length < 6 || !lines.some((l) => l.s === 'T') || !lines.some((l) => l.s === 'S')) return null;
  const qs = (Array.isArray(r.qs) ? r.qs : []).map((q) => ({ q: text(q && q.q), opts: [text(q && q.right), ...(Array.isArray(q && q.wrong) ? q.wrong.map((w) => text(w)) : [])].filter(Boolean).slice(0, 3), why: text(q && q.why) })).filter((q) => q.q && q.opts.length === 3);
  const taken = new Set(store.CHUNKS.map((c) => c.id));
  const chunks = [];
  for (const c of r.chunks) {
    const zh = text(c && c.zh, 40);
    if (!zh || !text(c.en) || taken.has(zh)) continue;
    taken.add(zh);
    const pieces = text(c.ex).split('|').map((p) => p.trim()).filter(Boolean);
    chunks.push({ id: zh, zh, en: text(c.en), note: text(c.note), ex: pieces.length >= 3 ? pieces : [pieces.join('') || zh], exEn: text(c.exEn) || text(c.en), scene: id });
  }
  if (chunks.length < 3 || !text(r.zh, 12)) return null;
  return { id, line: 'L6', gen: true, zh: text(r.zh, 12), en: text(r.en, 40) || 'New scene', who: text(r.who, 6) || '学生', setup: text(r.setup), culture: text(r.culture), lines, qs, chunks };
}

export function composeView() {
  const el = h('div', { class: 'page' }, h('p', { class: 'note' }, 'Checking the connection to Claude…'));
  let alive = true;
  let ctl = null;

  async function form() {
    const how = await backend();
    if (!alive) return;
    if (!how) {
      el.replaceChildren(h('section', { class: 'panel' },
        h('h2', null, h('span', { lang: 'zh-CN' }, '自编'), ' New scenes need Claude'),
        h('p', null, 'Open the app from its claude.ai page, or add an API key on the Talk screen.'),
        h('div', { class: 'actions' }, button('Set up on the Talk screen', 'primary', () => go('talk')))));
      return;
    }
    const topic = h('textarea', { id: 'compose-topic', rows: 2, placeholder: 'What should the conversation be about?', 'aria-label': 'Topic for the new scene' });
    el.replaceChildren(h('section', { class: 'panel' },
      h('h2', null, h('span', { lang: 'zh-CN' }, '自编'), ' A scene written for you'),
      h('p', null, 'Name a situation from your work. Claude writes a conversation at your level, with questions, phrases to keep and a note on the culture behind it.'),
      topic,
      h('div', { class: 'ideas' }, IDEAS.map((t) => h('button', { class: 'btn chip', type: 'button', onclick: () => { topic.value = t; } }, t))),
      h('div', { class: 'actions' }, button('Write the scene', 'primary', () => {
        if (topic.value.trim().length < 6) return toast('Describe the situation in a few words');
        write(topic.value.trim());
      }, 'arrow'))));
  }

  async function write(topic) {
    const tests = store.tests();
    const level = tests.length ? `about HSK ${Math.max(4, tests[tests.length - 1].level)}` : 'about HSK 5';
    ctl = new AbortController();
    el.replaceChildren(h('section', { class: 'panel' },
      h('h2', null, h('span', { lang: 'zh-CN' }, '自编'), ' Writing your scene'),
      h('p', null, 'Claude is writing it now. This takes up to a minute.'),
      h('div', { class: 'bar busy' }, h('i')),
      h('div', { class: 'actions' }, button('Cancel', 'ghost', () => { ctl.abort(); form(); }))));
    let r;
    try {
      r = await askJson(`Write a short Mandarin dialogue for one particular learner, as JSON.

The learner is an American university career advisor who works with business-analytics master's students, many of them from China. They spoke Mandarin well ten years ago (two years in Shanghai) and are bringing it back. Their comprehension is ${level}.

Topic: "${topic}"

The dialogue is between the advisor (speaker "T", the learner's own part) and a student or another person they deal with at work (speaker "S"). Write natural, colloquial Mainland Mandarin in simplified characters, the way people actually talk. 10 to 12 lines, alternating speakers, one or two sentences each. Pitch the vocabulary a notch above the learner's level, and work in at least two idiomatic expressions or pieces of current slang where they fit.

Reply with only a JSON object in this shape:
{"zh":"title in 3 to 6 characters","en":"English title, 2 to 4 words","who":"the other speaker's name, in characters","setup":"one English sentence setting the scene","culture":"one or two English sentences on a cultural or pragmatic point the dialogue shows","lines":[{"s":"S or T","zh":"the line","en":"a natural English translation"}],"qs":[{"q":"a comprehension or inference question, in Chinese","right":"the correct answer, in Chinese","wrong":["a wrong answer","another wrong answer"],"why":"one English sentence"}],"chunks":[{"zh":"a phrase of 3 to 12 characters taken from the dialogue that is worth memorising","en":"its English equivalent","note":"one English sentence on usage or register","ex":"a NEW sentence using the phrase, cut into 4 to 6 pieces with | between the pieces, each punctuation mark kept on the piece before it","exEn":"that sentence in English"}]}
Give exactly 2 questions and 6 chunks.`, ctl.signal);
    } catch (e) {
      if (!alive || e.code === 'cancelled') return;
      await form();
      toast(MESSAGES[e.code] || MESSAGES.failed);
      return;
    }
    if (!alive) return;
    const sc = toScene(r);
    if (!sc) { await form(); toast('That attempt came back malformed. Try again.'); return; }
    store.addScene(sc);
    store.annotateScenes();
    go('scene-' + sc.id);
  }

  form();
  return { el, title: '自编', sub: 'A new scene, written for you', back: 'scenes', destroy: () => { alive = false; if (ctl) ctl.abort(); } };
}
