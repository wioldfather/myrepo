// One station: listen blind, check understanding, read the transcript, then play the advisor yourself.
import * as store from './store.js';
import { speak, stop, canSpeak as deviceVoice, hasClip, hasSecondVoice, sfx } from './audio.js';
import { h, fill, zh, icon, go, button, sayButton, sleep, speakBox, heardLine, summary } from './ui.js';
import { wayOut } from './journey.js';

// The advisor (you) and the student should sound like two people.
export const voiceFor = (who, rate = 1) => (who === 'T' ? { rate, pitch: hasSecondVoice() ? 1 : 0.9 } : { rate, alt: true });

const STEP_LABEL = { listen: ['听', 'Listen'], check: ['懂', 'Check'], read: ['读', 'Read'], speak: ['说', 'Speak'] };

export function sceneView(id) {
  const sc = store.sceneById(id);
  if (!sc) return { el: h('div', { class: 'page' }, h('p', { class: 'note' }, 'That station does not exist.'), button('All scenes', 'primary', () => go('scenes'))), title: '场景', back: 'scenes' };

  const canSpeak = () => deviceVoice() || sc.lines.every((l) => hasClip(l.zh)); // recordings stand in for a missing voice
  let gen = 0; // bumped whenever the step changes, so stale async work stops itself
  const body = h('div', { class: 'scene-body' });
  const tabs = h('div', { class: 'steps', role: 'tablist' });
  const el = h('div', { class: 'page scene' }, tabs, body);
  const steps = { listen, check, read, speak: roleplay };

  function show(step) {
    gen++;
    stop();
    const st = store.sceneState(id);
    fill(tabs, ...store.STEPS.map((s) =>
      h('button', { class: (s === step ? 'on ' : '') + (st[s] ? 'done' : ''), type: 'button', role: 'tab', 'aria-selected': s === step, onclick: () => show(s) },
        h('b', { lang: 'zh-CN' }, STEP_LABEL[s][0]), h('span', null, STEP_LABEL[s][1]))));
    fill(body, steps[step]());
    window.scrollTo(0, 0);
  }

  /* 1. Listen with the text hidden, at natural speed. */
  function listen() {
    const my = gen;
    const rows = sc.lines.map((l) => h('div', { class: 'bub ghost ' + (l.s === 'T' ? 'me' : 'them') }, h('i', { style: { width: Math.min(100, 22 + l.zh.length * 3.4) + '%' } })));
    const playBtn = h('button', { class: 'bigplay', type: 'button' });
    const slowBtn = h('button', { class: 'btn chip', type: 'button', 'aria-pressed': 'false' }, '0.75×');
    const nextBtn = button('Check what you caught', 'primary', () => show('check'), 'arrow');
    let playing = false;
    let at = 0;
    let slow = false;
    let run = 0;
    const paint = () => {
      fill(playBtn, icon(playing ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play the scene');
      rows.forEach((r, i) => r.classList.toggle('now', playing && i === at));
    };
    async function play() {
      const mine = ++run;
      playing = true;
      for (; at < sc.lines.length; at++) {
        paint();
        rows[at].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const ok = await speak(sc.lines[at].zh, voiceFor(sc.lines[at].s, slow ? 0.75 : 1));
        if (mine !== run || my !== gen) return;
        if (!ok && !canSpeak()) return show('listen'); // the browser turned out to be silent: redraw with the no-audio path
        await sleep(260);
        if (mine !== run || my !== gen) return;
      }
      playing = false;
      at = 0;
      store.markScene(id, 'listen');
      nextBtn.classList.add('pulse');
      paint();
    }
    playBtn.onclick = () => {
      if (playing) { run++; playing = false; stop(); paint(); } else play();
    };
    slowBtn.onclick = () => { slow = !slow; slowBtn.setAttribute('aria-pressed', slow); };
    paint();
    return h('div', null,
      h('p', { class: 'setup' }, sc.setup),
      canSpeak()
        ? h('div', { class: 'player' }, playBtn, h('div', null, h('b', null, 'Listen first. No text.'), h('small', null, 'Natural speed. Replay as often as you like.')), slowBtn)
        : h('p', { class: 'note warn' }, 'There is no Mandarin voice on this device, so this scene cannot be played aloud. Go straight to the transcript.'),
      h('div', { class: 'thread' }, rows),
      h('div', { class: 'actions' }, canSpeak() ? nextBtn : button('Read the transcript', 'primary', () => show('read'), 'arrow')));
  }

  /* 2. Comprehension and inference, asked in Chinese. */
  function check() {
    let i = 0;
    let right = 0;
    const box = h('div', { class: 'quiz' });
    function ask() {
      const q = sc.qs[i];
      const opts = store.shuffle(q.opts.map((t, k) => ({ t, ok: k === 0 })));
      const why = h('p', { class: 'why', hidden: true }, q.why);
      const nextBtn = button(i < sc.qs.length - 1 ? 'Next question' : 'Read the transcript', 'primary', () => {
        if (++i < sc.qs.length) return ask();
        store.markScene(id, 'check');
        store.addKm(right);
        show('read');
      }, 'arrow');
      nextBtn.hidden = true;
      const buttons = opts.map((o) => h('button', { class: 'opt', type: 'button', onclick: () => {
        if (!nextBtn.hidden) return;
        buttons.forEach((b, k) => { b.disabled = true; if (opts[k].ok) b.classList.add('ok'); });
        if (o.ok) { right++; sfx('good'); } else { buttons[opts.indexOf(o)].classList.add('no'); sfx('bad'); }
        why.hidden = false;
        nextBtn.hidden = false;
        nextBtn.focus();
      } }, zh(o.t)));
      fill(box, h('div', { class: 'q-count' }, `${i + 1} / ${sc.qs.length}`), h('h2', { class: 'q' }, zh(q.q), sayButton(q.q)), h('div', { class: 'opts' }, buttons), why, h('div', { class: 'actions' }, nextBtn));
    }
    ask();
    return box;
  }

  /* 3. The transcript, the phrases worth keeping, and the cultural note. */
  function bubble(l, res) {
    return h('button', { class: 'bub ' + (l.s === 'T' ? 'me' : 'them'), type: 'button', onclick: () => speak(l.zh, voiceFor(l.s)) },
      h('small', { class: 'who', lang: 'zh-CN' }, l.s === 'T' ? '你' : sc.who),
      zh(l.zh, { hit: res?.hit }),
      h('span', { class: 'en' }, l.en));
  }
  function read() {
    const thread = h('div', { class: 'thread' }, sc.lines.map((l) => bubble(l)));
    const enBtn = h('button', { class: 'btn chip', type: 'button', 'aria-pressed': 'false', onclick: () => {
      const on = thread.classList.toggle('show-en');
      enBtn.setAttribute('aria-pressed', on);
    } }, 'English');
    return h('div', null,
      h('div', { class: 'toolbar' }, h('span', { class: 'note' }, 'Tap a line to hear it.'), enBtn),
      thread,
      h('h2', { class: 'sub' }, h('span', { lang: 'zh-CN' }, '带走'), ' Take these with you'),
      h('ul', { class: 'chunks' }, sc.chunks.map((c) => h('li', null,
        h('div', { class: 'chunk-top' }, zh(c.zh, { cls: 'chunk-zh' }), sayButton(c.zh)),
        h('div', { class: 'chunk-en' }, c.en),
        h('div', { class: 'chunk-note' }, c.note)))),
      h('aside', { class: 'culture' }, h('b', null, h('span', { lang: 'zh-CN' }, '文化'), ' Behind the words'), h('p', null, sc.culture)),
      h('div', { class: 'actions' }, button('Now you play the advisor', 'primary', () => { store.markScene(id, 'read'); show('speak'); }, 'arrow')));
  }

  /* 4. Role-play: the student's lines play; yours appear only as an English cue until you have said them. */
  function roleplay() {
    const my = gen;
    const thread = h('div', { class: 'thread show-en' });
    const dock = h('div', { class: 'dock' });
    const mine = sc.lines.filter((l) => l.s === 'T').length;
    let i = 0;
    let said = 0;
    const scroll = () => dock.scrollIntoView({ block: 'end', behavior: 'smooth' });

    async function advance() {
      if (my !== gen) return;
      if (i >= sc.lines.length) return finish();
      const l = sc.lines[i];
      if (l.s === 'S') {
        thread.append(bubble(l));
        fill(dock, h('p', { class: 'note' }, sc.who + ' is speaking…'));
        scroll();
        await speak(l.zh, voiceFor('S'));
        if (my !== gen) return;
        await sleep(canSpeak() ? 200 : 700);
        i++;
        advance();
      } else turn(l);
    }
    function turn(l) {
      const box = speakBox(l.zh, (res) => reveal(l, res));
      fill(dock, 
        h('div', { class: 'cue' }, h('small', null, `Your line ${said + 1} of ${mine}. Say it in Chinese.`), h('p', null, l.en)),
        box,
        h('div', { class: 'actions' }, button(box ? 'Show the line' : 'I said it. Show the line', box ? 'ghost' : 'primary', () => reveal(l, null))));
      scroll();
    }
    function reveal(l, res) {
      const b = bubble(l, res);
      thread.append(b);
      speak(l.zh, voiceFor('T'));
      if (res && !res.url) sfx(res.score >= 0.85 ? 'good' : 'tap');
      fill(dock, 
        heardLine(res, l.zh),
        h('div', { class: 'actions' },
          button('Next', 'primary', () => { said++; i++; advance(); }, 'arrow'),
          button('Try again', 'ghost', () => { b.remove(); stop(); turn(l); }, 'again')));
      scroll();
      dock.querySelector('.primary').focus({ preventScroll: true });
    }
    function finish() {
      const first = !store.sceneState(id).speak;
      store.markScene(id, 'speak');
      store.addKm(5);
      store.markDay();
      sfx('done');
      fill(dock, summary({
        zhTitle: '到站',
        title: 'Station complete',
        rows: [['Lines spoken', mine], ['Distance', '+5 km']],
        note: first ? `${sc.chunks.length} phrases from this stop now come first in Recall.` : 'Each replay makes the next conversation easier to start.',
        actions: [...wayOut('Play it again', () => show('speak')), button('Continue it live with Claude', 'ghost', () => go('talk-' + id), 'mic')],
      }));
      scroll();
    }
    advance();
    return h('div', null, h('p', { class: 'setup' }, sc.setup), thread, dock);
  }

  const st = store.sceneState(id);
  show(store.STEPS.find((s) => !st[s]) || 'listen');
  return { el, title: sc.zh, sub: sc.en, back: 'scenes', destroy: () => { gen++; } };
}
