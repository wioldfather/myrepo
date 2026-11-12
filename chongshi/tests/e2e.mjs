// End-to-end checks in headless Chromium. Start the server first (`npm run serve`), then `npm test`.
// Speech synthesis is faked (tests/fake-speech.js) so audio sequencing can be asserted without a sound card.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCENES, CHENGYU, REGISTER, PY } from '../js/content.gen.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const FAKE_TTS = readFileSync(join(here, 'fake-speech.js'), 'utf8');
const URL = process.env.APP_URL || 'http://localhost:4173/';
const CHUNKS = SCENES.flatMap((s) => s.chunks);
const han = (s) => [...s].filter((c) => /[一-鿿]/.test(c));

const FAKE_SR = `window.webkitSpeechRecognition = window.SpeechRecognition = class {
  start() { setTimeout(() => {
    if (window.__SR_ERROR) { this.onerror({ error: window.__SR_ERROR }); this.onend(); return; }
    this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: window.__SR_TEXT || '' }], { isFinal: true })] });
    this.onend();
  }, 30); }
  stop() {}
};`;
const NO_SR = 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;';
const NO_MIC = NO_SR + 'Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });';
const NO_ZH_VOICE = `(() => { const s = window.speechSynthesis; const all = s.getVoices(); s.getVoices = () => all.filter((v) => v.lang.startsWith('en')); })();`;

const SILENT_TTS = `Object.defineProperty(window, 'speechSynthesis', { value: { speaking: false, pending: false, getVoices: () => [], addEventListener() {}, cancel() {}, speak() {} }, configurable: true }); window.SpeechSynthesisUtterance = function (t) { this.text = t; };`;

let failures = 0;
const results = [];
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

async function test(name, { scripts = [NO_MIC], viewport = { width: 390, height: 844 }, tts = true } = {}, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] });
  if (tts) await ctx.addInitScript(FAKE_TTS);
  for (const s of scripts) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  try {
    await page.goto(URL);
    await page.waitForSelector('.board');
    await fn(page);
    if (errors.length) throw new Error('console errors: ' + errors.join(' | '));
    results.push('ok    ' + name);
  } catch (e) {
    failures++;
    results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n').slice(0, 4).join('\n      '));
    await page.screenshot({ path: join(here, 'fail-' + name.replace(/\W+/g, '-') + '.png') }).catch(() => {});
  }
  await ctx.close();
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chongshi.v1') || '{}'));
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(60); };
const noOverflow = async (page, where) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(o <= 0, `horizontal overflow of ${o}px at ${where}`);
};

/* ---------- puzzle solvers: read the round like a player would, look the answer up in the content ---------- */
async function solveBoard(page, answer, { fumble = false } = {}) {
  if (fumble) {
    // put the pieces in a wrong order first: the board must reject it, keep nothing wrong, and let us retry
    const wrong = [...answer].reverse();
    if (wrong.join('|') !== answer.join('|')) {
      for (const t of wrong) await page.locator('.bank .tile:not(.used)', { hasText: new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first().click();
      await page.waitForSelector('.slot.bad');
      await page.waitForFunction(() => !document.querySelector('.slot.bad'));
    }
  }
  for (;;) {
    const slots = await page.$$eval('.slots .slot', (els) => els.map((e) => ({ t: e.textContent, ok: e.classList.contains('ok') })));
    const i = slots.findIndex((s) => !s.t);
    if (i < 0) break;
    await page.locator('.bank .tile:not(.used)', { hasText: new RegExp('^' + answer[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first().click();
  }
  await page.waitForSelector('.verdict:not([hidden])');
}
async function playRound(page, mode = 'solve') {
  const kind = await page.locator('.run-kind').textContent();
  if (kind === '分寸') {
    const sit = await page.locator('.situation').textContent();
    const item = REGISTER.find((r) => r.sit === sit);
    assert(item, 'register item not found: ' + sit);
    const pick = mode === 'wrong' ? item.opts[1].zh : item.opts[0].zh;
    const texts = await page.$$eval('.opt', (els) => els.map((e) => [...e.querySelector('.zh').childNodes].map((n) => (n.nodeName === 'RUBY' ? n.firstChild.textContent : n.textContent)).join('')));
    await page.locator('.opt').nth(texts.indexOf(pick)).click();
    await page.waitForSelector('.opt.ok .fb');
  } else if (mode === 'giveup') {
    await page.click('.helps >> text=Give up');
  } else if (mode === 'hint') {
    while (!(await page.locator('.verdict:not([hidden])').count())) await page.click('text=Place one for me');
  } else if (kind === '成语') {
    const tiles = await page.$$eval('.bank .tile', (els) => els.map((e) => e.textContent));
    const y = CHENGYU.find((c) => [...c.zh].every((ch) => tiles.includes(ch)) && tiles.length >= 4);
    const clue = await page.$eval('.clue .zh', (e) => [...e.childNodes].map((n) => (n.nodeName === 'RUBY' ? n.firstChild.textContent : n.textContent)).join(''));
    const item = CHENGYU.find((c) => c.clue === clue);
    assert(item && y, 'chengyu not found for clue ' + clue);
    await solveBoard(page, [...item.zh], { fumble: mode === 'fumble' });
  } else if (kind === '连句') {
    const en = await page.locator('.prompt-en').textContent();
    const c = CHUNKS.find((x) => x.exEn === en);
    assert(c, 'weave chunk not found: ' + en);
    await solveBoard(page, c.ex, { fumble: mode === 'fumble' });
  } else {
    const tiles = await page.$$eval('.bank .tile', (els) => els.map((e) => e.textContent));
    const shape = await page.$$eval('.slots > *', (els) => els.map((e) => (e.classList.contains('fixed') ? e.textContent : '□')).join(''));
    const c = CHUNKS.find((x) => {
      const s = [...x.zh].map((ch) => (/[一-鿿]/.test(ch) ? '□' : ch)).join('');
      return s === shape && han(x.zh).every((ch) => tiles.includes(ch));
    });
    assert(c, 'dictation chunk not found for shape ' + shape);
    await solveBoard(page, han(c.zh), { fumble: mode === 'fumble' });
  }
  await page.waitForSelector('.verdict:not([hidden]) .primary');
}
async function playRun(page, modes) {
  let n = 0;
  for (;;) {
    await playRound(page, modes[n % modes.length]);
    n++;
    await page.click('.verdict .primary');
    if (await page.locator('.summary').count()) break;
  }
  return n;
}

/* ---------- tests ---------- */
await test('home, tabs and pinyin toggle', {}, async (page) => {
  for (const h of ['scenes', 'recall', 'games', 'home']) { await page.click(`#tabs a[data-tab="${h}"]`); await page.waitForTimeout(50); assert((await page.locator('#tabs a.on').getAttribute('data-tab')) === h, 'tab ' + h); }
  await go(page, 'scenes');
  assert((await page.locator('.station').count()) === SCENES.length, 'all stations listed');
  assert(!(await page.locator('rt').first().isVisible()), 'pinyin hidden by default');
  await page.click('#py');
  assert(await page.locator('rt').first().isVisible(), 'pinyin visible after toggle');
  await page.reload();
  await page.waitForSelector('.station');
  assert(await page.locator('rt').first().isVisible(), 'pinyin choice persisted');
});

await test('scene: listen, check, read, role-play (say-aloud fallback)', {}, async (page) => {
  const sc = SCENES[0];
  await go(page, 'scene-' + sc.id);
  assert((await page.locator('.bub.ghost').count()) === sc.lines.length, 'text hidden while listening');
  await page.click('.bigplay');
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem('chongshi.v1') || '{}').scenes?.[id]?.listen, sc.id, { timeout: 15000 });
  const spoken = await page.evaluate(() => window.__spoken);
  assert(spoken.length === sc.lines.length, `spoke ${spoken.length} of ${sc.lines.length} lines`);
  assert(new Set(spoken.map((s) => s.voice)).size === 2, 'student and advisor use different voices');
  await page.click('text=Check what you caught');
  for (const q of sc.qs) {
    const texts = await page.$$eval('.opt', (els) => els.map((e) => [...e.querySelector('.zh').childNodes].map((n) => (n.nodeName === 'RUBY' ? n.firstChild.textContent : n.textContent)).join('')));
    await page.locator('.opt').nth(texts.indexOf(q.opts[0])).click();
    await page.waitForSelector('.opt.ok');
    assert(!(await page.locator('.opt.no').count()), 'correct answer accepted');
    await page.click('.quiz .primary');
  }
  await page.waitForSelector('.chunks');
  assert(!(await page.locator('.bub .en').first().isVisible()), 'English hidden by default');
  await page.click('text=English');
  assert(await page.locator('.bub .en').first().isVisible(), 'English shows on demand');
  assert((await page.locator('.chunks li').count()) === sc.chunks.length, 'chunks listed');
  await page.click('text=Now you play the advisor');
  const mine = sc.lines.filter((l) => l.s === 'T').length;
  for (let i = 0; i < mine; i++) {
    await page.waitForSelector('.cue');
    assert(!(await page.locator('.speakbox').count()), 'no mic control without a microphone');
    await page.click('text=I said it. Show the line');
    await page.click('.dock .primary');
  }
  await page.waitForSelector('.summary');
  const st = await state(page);
  assert(['listen', 'check', 'read', 'speak'].every((k) => st.scenes[sc.id][k]), 'all four steps recorded');
  await page.reload();
  await go(page, 'scenes');
  assert((await page.locator('.station').first().locator('.pips i.on').count()) === 4, 'progress survives reload');
});

await test('recall: scheduling and persistence', {}, async (page) => {
  await go(page, 'recall');
  const order = [2, 1, 0, 2, 2, 1];
  const seen = [];
  for (let i = 0; ; i++) {
    if (await page.locator('.summary').count()) break;
    const cue = await page.locator('.cue-en').textContent();
    seen.push(cue);
    if (i === 0) { await page.click('text=Hint'); assert(await page.locator('.hint').isVisible(), 'hint shows'); }
    await page.click('text=Show answer');
    await page.waitForSelector('.rate');
    await page.locator('.rate-btn').nth(order[i % order.length]).click();
    assert(i < 40, 'recall session never ended');
  }
  const st = await state(page);
  const cards = Object.values(st.cards);
  assert(cards.length === 6, 'six new cards introduced, got ' + cards.length);
  assert(seen.length > 6, 'a blanked card came back within the session');
  const first = st.cards[CHUNKS[0].id];
  assert(first.i === 10 && first.d > Math.floor(Date.now() / 864e5), 'instant on first sight jumps ten days out');
  assert(cards.some((c) => c.i === 3), 'effortful card returns in three days');
  await page.goto(URL + '#home');
  await page.reload();
  await page.waitForSelector('.board');
  assert((await state(page)).km === st.km && st.km > 0, 'distance persisted');
  assert((await page.locator('.punch i.on').count()) === 1, 'ride punched for this week');
});

await test('recall: live speech recognition scores by sound', { scripts: [FAKE_SR] }, async (page) => {
  await go(page, 'recall');
  const zh = CHUNKS[0].zh; // 随便坐。
  await page.evaluate(() => { window.__SR_TEXT = '随便做'; }); // homophone of 坐: must still count
  await page.click('.mic');
  await page.waitForSelector('.pct');
  assert((await page.locator('.pct').textContent()) === '100%', 'homophone matched by sound');
  assert((await page.locator('.answer ruby.hit').count()) === han(zh).length, 'matched characters marked');
});

await test('speech falls back: recognition error → recording → say aloud', { scripts: [FAKE_SR] }, async (page) => {
  await go(page, 'scene-s1');
  await page.click('.steps button:nth-child(4)');
  await page.waitForSelector('.cue');
  await page.evaluate(() => { window.__SR_ERROR = 'network'; });
  await page.click('.mic');
  await page.waitForFunction(() => /record yourself/i.test(document.querySelector('.mic-status').textContent));
  await page.click('.mic');
  await page.waitForFunction(() => /Recording/.test(document.querySelector('.mic-status').textContent));
  await page.waitForTimeout(250);
  await page.click('.mic');
  await page.waitForSelector('.heard .chip');
  assert((await page.locator('.heard .chip').count()) === 2, 'playback buttons for you and the model');
});

await test('no Mandarin voice: scenes, dictation and ride degrade clearly', { scripts: [NO_MIC, NO_ZH_VOICE] }, async (page) => {
  await go(page, 'scene-s2');
  assert(await page.locator('.note.warn').isVisible(), 'scene explains missing voice');
  assert(!(await page.locator('.bigplay').count()), 'no dead play button');
  await go(page, 'game-dictation');
  assert(await page.locator('.pinyin').isVisible(), 'dictation falls back to pinyin');
  await go(page, 'ride');
  assert(await page.locator('.ride .btn.big').isDisabled(), 'ride cannot start silently');
  assert(await page.locator('.ride .note.warn').isVisible(), 'ride explains why');
});

await test('a browser that accepts speech but stays silent is caught', { tts: false, scripts: [NO_MIC, SILENT_TTS] }, async (page) => {
  await go(page, 'scene-s1');
  await page.click('.bigplay');
  await page.waitForSelector('.note.warn', { timeout: 9000 });
  assert(!(await state(page)).scenes?.s1?.listen, 'a scene nobody heard is not marked as heard');
  await go(page, 'ride');
  assert(await page.locator('.ride .btn.big').isDisabled(), 'ride will not start');
});

for (const type of ['dictation', 'weave', 'chengyu', 'register']) {
  await test('puzzle run: ' + type, {}, async (page) => {
    await go(page, 'game-' + type);
    const modes = type === 'register' ? ['solve', 'wrong', 'solve'] : ['solve', 'fumble', 'hint', 'giveup'];
    const n = await playRun(page, modes);
    assert(n === (type === 'register' ? 6 : 8), 'round count ' + n);
    const st = await state(page);
    assert(st.best[type] >= 2, 'best score saved');
    assert(st.km > 0 && Object.keys(st.days).length === 1, 'distance and day recorded');
    if (type === 'chengyu' || type === 'register') assert(Object.keys(st.cards).length === n, 'items scheduled for spaced return');
    await noOverflow(page, type + ' summary');
  });
}

await test('ears-only ride: sequencing, pause, rating, skip, finish', {}, async (page) => {
  await page.evaluate(() => { window.__CS_FAST = 60; window.__SPEAK_MS = 25; });
  await go(page, 'ride');
  await page.click('text=10 min');
  await page.click('.ride .btn.big');
  await page.waitForSelector('.led-rate:not([hidden])', { timeout: 20000 });
  let spoken = await page.evaluate(() => window.__spoken);
  // nothing is due on a first ride, so it opens on a scene and only then asks for its phrases
  assert(spoken[0].lang === 'en-US' && spoken[0].text === SCENES[0].setup, 'opens with the scene set-up in English');
  assert(spoken[1].text === SCENES[0].lines[0].zh.replace(/[“”]/g, ''), 'then the scene at natural speed');
  assert(spoken.some((s) => s.text.startsWith('问题：')), 'scene questions were asked aloud');
  const last = spoken[spoken.length - 1].text;
  assert(SCENES[0].chunks.some((c) => c.zh.replace(/[“”]/g, '') === last), 'first recall card comes from the scene just heard, got ' + last);
  assert(spoken[spoken.length - 2].lang === 'en-US', 'English cue precedes the Chinese model');
  await page.click('.led-rate .no');
  await page.click('.ctl.main');
  const before = (await page.evaluate(() => window.__spoken)).length;
  await page.waitForTimeout(500);
  assert((await page.evaluate(() => window.__spoken)).length === before, 'paused: nothing more is spoken');
  await page.click('.ctl.main');
  await page.click('[aria-label="Skip"]');
  await page.waitForSelector('.summary', { timeout: 60000 });
  const st = await state(page);
  const blanked = Object.values(st.cards).filter((c) => c.i === 0);
  assert(blanked.length === 1 && blanked[0].d === Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5) + 1, 'the one blanked card is due tomorrow');
  assert((await page.locator('.summary-rows dd').nth(2).textContent()) === '1', 'summary counts the blank');
  assert(Object.values(st.scenes).some((s) => s.listen), 'a scene was marked as heard');
  assert(st.km > 0, 'distance recorded');
});

await test('seated ride chains scene → puzzle mix → recall', {}, async (page) => {
  await page.evaluate(() => { window.__SPEAK_MS = 5; });
  await page.click('.dep >> nth=1');
  await page.waitForSelector('.steps');
  assert((await page.locator('#leg').textContent()) === 'Leg 1/3', 'leg badge');
  await page.click('.steps button:nth-child(4)');
  while (!(await page.locator('.summary').count())) {
    if (await page.locator('text=I said it. Show the line').count()) { await page.click('text=I said it. Show the line'); await page.click('.dock .primary'); } else await page.waitForTimeout(40);
  }
  await page.click('text=Next leg');
  await page.waitForSelector('.run-kind');
  await playRun(page, ['solve']);
  await page.click('text=Next leg');
  await page.waitForSelector('.card');
  const first = await page.locator('.card-from').textContent();
  assert(first.startsWith(SCENES[0].zh), 'recall opens on phrases from the scene just played, got ' + first);
  while (!(await page.locator('.summary').count())) { await page.click('text=Show answer'); await page.locator('.rate-btn').nth(2).click(); }
  await page.click('text=Ride complete');
  await page.waitForSelector('.board');
  assert(await page.locator('#leg').isHidden(), 'ride ended');
});

await test('backup code round-trips; reset needs two taps', {}, async (page) => {
  await go(page, 'recall');
  await page.click('text=Show answer');
  await page.locator('.rate-btn').nth(2).click();
  const before = await state(page);
  await page.click('#gear');
  await page.click('text=Copy my code');
  const code = await page.inputValue('#backup-code');
  assert(code.startsWith('CS1.'), 'code produced');
  await page.click('text=Reset progress');
  assert(Object.keys((await state(page)).cards).length === 1, 'one tap does not erase');
  await page.click('text=Tap again to erase everything');
  assert(Object.keys((await state(page)).cards).length === 0, 'second tap erases');
  await page.click('#gear');
  await page.fill('#backup-code', code);
  await page.click('text=Restore from code');
  assert(JSON.stringify((await state(page)).cards) === JSON.stringify(before.cards), 'restored exactly');
});

for (const [w, hgt] of [[360, 640], [390, 844], [768, 1024], [1280, 800]]) {
  await test(`layout ${w}×${hgt}: no sideways scroll, controls reachable`, { viewport: { width: w, height: hgt } }, async (page) => {
    await page.click('#py');
    for (const h of ['home', 'scenes', 'scene-s14', 'recall', 'games', 'game-weave', 'game-dictation', 'game-chengyu', 'game-register', 'ride']) {
      await go(page, h);
      await noOverflow(page, h);
      if (h === 'scene-s14') { await page.click('.steps button:nth-child(3)'); await noOverflow(page, 'transcript'); }
      if (h === 'recall') { await page.click('text=Show answer'); await noOverflow(page, 'recall answer'); }
    }
    await go(page, 'home');
    const tabs = await page.locator('#tabs').boundingBox();
    assert(w >= 900 ? tabs.width < 120 && tabs.height > 400 : tabs.y + tabs.height <= hgt + 1 && tabs.width === w, 'tab bar placement');
  });
}

console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : `\nall ${results.length} passed`);
await browser.close();
process.exit(failures ? 1 : 0);
