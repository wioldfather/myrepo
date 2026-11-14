// Ears-only ride: a hands-free loop for when you can't look at the screen.
//   Scene, cold    a whole conversation at natural speed → spoken questions
//   Recall         English cue → silence to answer aloud → the Chinese → silence to shadow → the Chinese again
//   Scene, again   the same conversation once more → shadow the advisor's lines
// The cycle repeats with the next scene until the chosen time is up. Nothing needs a tap; the two big rating zones are optional.
import * as store from './store.js';
import { speak, stop, sfx, canSpeak, ttsStatus, keepAwake } from './audio.js';
import { h, fill, zh, icon, go, button, sleep, summary, isHan } from './ui.js';
import { voiceFor } from './scene.js';

class Skip extends Error {}
const hanLen = (s) => [...s].filter(isHan).length;
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function rideView() {
  const el = h('div', { class: 'ride' });
  let dead = false;
  let endRide = null;

  function intro() {
    let mins = store.settings().ride || 20;
    const pick = [10, 20, 30].map((m) => h('button', { class: 'btn chip', type: 'button', 'aria-pressed': m === mins, onclick: () => {
      mins = m;
      store.setSetting('ride', m);
      pick.forEach((b, i) => b.setAttribute('aria-pressed', [10, 20, 30][i] === m));
    } }, m + ' min'));
    const ok = canSpeak();
    fill(el, h('div', { class: 'ride-intro' },
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: () => go('home') }, icon('x')),
      h('h1', null, h('span', { lang: 'zh-CN' }, '耳机模式'), h('small', null, 'Ears-only ride')),
      h('ol', { class: 'how' },
        h('li', null, h('span', null, h('b', null, 'Hear the cue.'), 'An English prompt, or a full scene in Chinese.')),
        h('li', null, h('span', null, h('b', null, 'Answer in the gap.'), 'Out loud, or under your breath.')),
        h('li', null, h('span', null, h('b', null, 'Shadow the model.'), 'Say it again right behind the voice.'))),
      h('div', { class: 'pick', role: 'group', 'aria-label': 'Ride length' }, pick),
      ok ? null : h('p', { class: 'note warn' }, ttsStatus() === 'unsupported'
        ? 'This browser cannot speak text, so the ears-only ride is unavailable here. The seated ride works without audio.'
        : 'No Mandarin voice is installed on this device. Add one in your system speech settings, reload, and this ride will work.'),
      h('button', { class: 'btn primary big', type: 'button', disabled: !ok || null, onclick: () => run(mins) }, icon('play'), h('span', null, 'Start')),
      h('p', { class: 'note' }, 'Keep the phone unlocked. The screen stays awake during the ride, because phones stop speaking when they lock.')));
  }

  function run(mins) {
    const budget = mins * 60;
    const fast = window.__CS_FAST || 1; // test hook: compresses the silences
    let paused = false;
    let token = 0;
    let wake = null;
    let replay = false;
    let elapsed = 0;
    let current = null; // the card on screen, while it can be rated
    const done = { cards: 0, blanked: 0, scenes: 0 };
    const used = new Set();
    const heard = [];
    let retry = [];

    /* --- display --- */
    const timeEl = h('span', { class: 'led-clock' });
    const kindEl = h('span', { class: 'led-kind' });
    const labelEl = h('div', { class: 'led-label' });
    const textEl = h('div', { class: 'led-text' });
    const subEl = h('div', { class: 'led-sub' });
    const barEl = h('i');
    const pauseBtn = h('button', { class: 'ctl main', type: 'button' });
    const rateEl = h('div', { class: 'led-rate', hidden: true },
      h('button', { type: 'button', class: 'no', onclick: () => rate(0) }, h('b', { lang: 'zh-CN' }, '忘了'), h('span', null, 'Blanked')),
      h('button', { type: 'button', class: 'ok', onclick: () => rate(1) }, h('b', { lang: 'zh-CN' }, '会了'), h('span', null, 'Had it')));
    const main = h('button', { class: 'led-main', type: 'button', 'aria-label': 'Pause or resume', onclick: toggle }, labelEl, textEl, subEl);
    fill(el, h('div', { class: 'led' },
      h('div', { class: 'led-top' }, timeEl, kindEl, h('button', { class: 'ctl', type: 'button', 'aria-label': 'End ride', onclick: () => finish(false) }, icon('x'))),
      main,
      h('div', { class: 'led-bar' }, barEl),
      rateEl,
      h('div', { class: 'led-ctl' },
        h('button', { class: 'ctl', type: 'button', 'aria-label': 'Replay this one', onclick: () => { replay = true; skip(); } }, icon('again')),
        pauseBtn,
        h('button', { class: 'ctl', type: 'button', 'aria-label': 'Skip', onclick: skip }, icon('next')))));

    const face = (label, text, sub) => {
      labelEl.textContent = label || '';
      fill(textEl, text || '');
      subEl.textContent = sub || '';
    };
    const paintPause = () => {
      fill(pauseBtn, icon(paused ? 'play' : 'pause'));
      pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      el.classList.toggle('paused', paused);
    };
    pauseBtn.onclick = toggle;
    const tick = setInterval(() => {
      if (!paused) elapsed += 0.5 * fast;
      timeEl.textContent = `${clock(Math.min(elapsed, budget))} / ${clock(budget)}`;
    }, 500);
    const onHide = () => { if (document.hidden && !paused) toggle(); };
    document.addEventListener('visibilitychange', onHide);

    /* --- transport --- */
    function toggle() {
      paused = !paused;
      if (paused) stop();
      else { wake?.(); wake = null; }
      paintPause();
    }
    function skip() {
      token++;
      stop();
      if (paused) toggle();
    }
    const resumed = () => new Promise((r) => { wake = r; });
    async function say(text, opts) {
      const my = token;
      for (;;) {
        if (dead || my !== token) throw new Skip();
        if (paused) { await resumed(); continue; }
        const ok = await speak(text, opts);
        if (dead || my !== token) throw new Skip();
        if (!ok && !canSpeak()) { finish(false); intro(); throw new Skip(); } // silent browser: back to the explanation
        if (!paused) return; // a pause cut the line off: say it again after resuming
      }
    }
    async function gap(ms, label) {
      const my = token;
      const total = ms / fast;
      let left = total;
      if (label) { labelEl.textContent = label; sfx('cue'); }
      while (left > 0) {
        if (dead || my !== token) { barEl.style.width = '0'; throw new Skip(); }
        if (paused) { await resumed(); continue; }
        const t0 = performance.now();
        await sleep(Math.min(100, left));
        if (!paused) left -= performance.now() - t0;
        barEl.style.width = Math.max(0, (left / total) * 100) + '%';
      }
      barEl.style.width = '0';
    }
    function rate(r) {
      if (!current) return;
      const c = current;
      current = null;
      store.rate(c.id, r);
      sfx(r ? 'good' : 'lift');
      if (!r) { done.blanked++; retry.push(c); }
      rateEl.className = 'led-rate chose-' + (r ? 'ok' : 'no');
    }

    /* --- units --- */
    async function cardUnit(c) {
      const n = hanLen(c.zh);
      current = null;
      rateEl.hidden = true;
      rateEl.className = 'led-rate';
      kindEl.textContent = '复习 Recall';
      face('Listen', c.en);
      await say(c.en, { lang: 'en' });
      await gap(2200 + n * 420, 'Say it in Chinese');
      current = c;
      rateEl.hidden = false;
      face('The model', zh(c.zh));
      await say(c.zh);
      await gap(900 + n * 330, 'Shadow it');
      face('Once more', zh(c.zh));
      await say(c.zh);
      await gap(1500);
      done.cards++;
    }
    async function playScene(sc, label) {
      let k = 0;
      for (const l of sc.lines) {
        face(label, zh(sc.zh), `${l.s === 'T' ? 'Advisor' : sc.who} · line ${++k} of ${sc.lines.length}`);
        await say(l.zh, voiceFor(l.s));
        await gap(260);
      }
    }
    // First pass: the whole conversation cold, then questions about it.
    async function sceneListen(sc) {
      current = null;
      rateEl.hidden = true;
      kindEl.textContent = '场景 Scene';
      face('Scene', zh(sc.zh), sc.setup);
      await say(sc.setup, { lang: 'en' });
      await playScene(sc, 'Just listen');
      store.markScene(sc.id, 'listen');
      done.scenes++;
      for (const q of sc.qs) {
        face('Question', zh(q.q));
        await say('问题：' + q.q);
        await gap(4500, 'Answer aloud');
        face('Answer', zh(q.opts[0]));
        await say(q.opts[0]);
        await gap(900);
      }
    }
    // Second pass, after its phrases have been drilled: hear it again, then speak the advisor's part.
    async function sceneShadow(sc) {
      current = null;
      rateEl.hidden = true;
      kindEl.textContent = '场景 Scene';
      face('Same scene', zh(sc.zh), 'Listen once more. You will catch more this time.');
      await say('Same scene, once more.', { lang: 'en' });
      await playScene(sc, 'Listen again');
      face('Your turn', zh(sc.zh), 'Shadow the advisor');
      await say("Now shadow the advisor's lines.", { lang: 'en' });
      for (const l of sc.lines.filter((x) => x.s === 'T')) {
        face('Shadow it', zh(l.zh), l.en);
        await say(l.zh, voiceFor('T'));
        await gap(800 + hanLen(l.zh) * 330, 'Shadow it');
      }
    }
    // Run one unit; Skip moves on, Replay runs it again.
    async function unit(fn) {
      for (;;) {
        try { return await fn(); } catch (e) {
          if (!(e instanceof Skip)) throw e;
          if (dead) return;
          if (!replay) return;
          replay = false;
        }
      }
    }
    function nextCards(n) {
      const out = retry.splice(0, 2);
      const pool = [...store.recallQueue(60, 60), ...store.aheadQueue(60)];
      for (const c of pool) {
        if (out.length >= n) break;
        if (!used.has(c.id) && !out.includes(c)) out.push(c);
      }
      if (out.length < n) used.clear();
      out.forEach((c) => used.add(c.id));
      return out;
    }
    const timeUp = () => dead || elapsed >= budget;

    async function loop() {
      keepAwake(true);
      paintPause();
      const cards = async (n) => {
        for (const c of nextCards(n)) {
          if (timeUp()) return;
          await unit(() => cardUnit(c));
        }
      };
      // One cycle is about seven minutes: a scene heard cold, its phrases recalled, the scene again, more recall.
      // If cards are already due, they come first as a warm-up.
      if (store.stats().due > 0) await cards(6);
      while (!timeUp()) {
        const sc = store.nextListen(heard);
        heard.push(sc.id);
        if (heard.length >= 6) heard.shift();
        await unit(() => sceneListen(sc));
        if (timeUp()) break;
        await cards(6);
        if (timeUp()) break;
        await unit(() => sceneShadow(sc));
        if (timeUp()) break;
        await cards(4);
      }
      if (!dead) finish();
    }

    // `silent` is for leaving mid-ride (back button, tab switch): save what was done, draw nothing.
    function finish(silent) {
      if (dead) return;
      dead = true;
      token++;
      stop();
      wake?.();
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onHide);
      keepAwake(false);
      const km = done.cards + done.scenes * 3;
      if (km) { store.addKm(km); store.markDay(); }
      if (silent) return;
      if (km) sfx('done');
      el.classList.remove('paused');
      fill(el, h('div', { class: 'ride-intro' }, summary({
        zhTitle: '到站了',
        title: km ? 'Ride complete' : 'Ride ended',
        rows: [['Time', clock(Math.min(elapsed, budget))], ['Phrases practised', done.cards], ['Marked as blanked', done.blanked], ['Scenes heard', done.scenes], ['Distance', `+${km} km`]],
        note: done.blanked ? 'The phrases you marked as blanked are due in Recall tomorrow.' : 'Unrated phrases keep their schedule. Rate them in Recall when you can look.',
        actions: [button('Back to today', 'primary', () => go('home')), button('Ride again', 'ghost', () => { dead = false; intro(); }, 'again')],
      })));
    }
    endRide = () => finish(true);
    loop();
  }

  intro();
  return { el, title: '耳机模式', sub: 'Ears-only ride', immersive: true, destroy: () => { endRide?.(); dead = true; } };
}
