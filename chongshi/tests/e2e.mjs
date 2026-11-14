// End-to-end checks in headless Chromium. Start the server first (`npm run serve`), then `npm test`.
// Speech synthesis is faked (tests/fake-speech.js) so audio sequencing can be asserted without a sound card.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCENES, CHENGYU, REGISTER, TALKS, KIDS, PY } from '../js/content.gen.js';
import { CLIPS } from '../js/audio.gen.js';
import { WORDS } from '../js/words.gen.js';

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

// A claude.ai page: `sample` answers in character, translates, hints, and writes the debrief.
const DEBRIEF = { level: 'HSK 5', hskk: '中级', summary: 'You kept the conversation moving. Work on measure words next.', fixes: [{ said: '我很高兴认识你', better: '很高兴认识你', why: 'Drop the subject; it is implied.' }], phrases: [{ zh: '慢慢说，不着急。', pinyin: 'màn màn shuō bù zháo jí', en: 'Take your time, no rush.', note: 'Calming a nervous student.' }] };
const FAKE_CLAUDE = `window.__asked = []; window.claude = { use: async (name) => (name !== 'sample' ? null : async (input, opts = {}) => {
  window.__asked.push(input);
  const flat = typeof input === 'string' ? input : input[0].content;
  const text = /JSON object/.test(flat) ? ${JSON.stringify(JSON.stringify(DEBRIEF))} : /^Translate/.test(flat) ? 'Hello! Have you been busy lately?' : /is stuck/.test(flat) ? '还行，就是有点儿累。 (Not bad, just a bit tired.)' : '老师好！最近有点儿忙。您呢？';
  if (opts.onText) opts.onText({ text, delta: text });
  return { text, truncated: false, modelTierApplied: 'quick' };
}) };`;
const ROBOT_VOICES = `window.__VOICES = [
  { name: 'Eddy (Chinese (China mainland))', lang: 'zh-CN', voiceURI: 'com.apple.eloquence.zh-CN.Eddy', localService: true },
  { name: 'Tingting', lang: 'zh-CN', voiceURI: 'com.apple.voice.compact.zh-CN.Tingting', localService: true },
  { name: 'Grandma (Chinese (China mainland))', lang: 'zh-CN', voiceURI: 'com.apple.eloquence.zh-CN.Grandma', localService: true },
  { name: 'Albert', lang: 'en-US', voiceURI: 'com.apple.speech.synthesis.voice.Albert', default: true, localService: true },
  { name: 'Samantha', lang: 'en-US', voiceURI: 'com.apple.voice.compact.en-US.Samantha', localService: true },
];`;
const WORD = new Map(Object.entries(WORDS).flatMap(([lv, t]) => t.split('\n').map((l) => { const [w, y, g] = l.split('\t'); return [w, { lv: +lv, g }]; })));

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
const plain = (loc) => loc.evaluate((e) => [...e.childNodes].map((n) => (n.nodeName === 'RUBY' ? n.firstChild.textContent : n.textContent)).join(''));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chongshi.v1') || '{}'));
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(60); };
const noOverflow = async (page, where) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(o <= 0, `horizontal overflow of ${o}px at ${where}`);
  // an absent optional element must never be written out as text
  const stray = await page.evaluate(() => { const w = document.createTreeWalker(document.querySelector('#view'), NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (/^(null|undefined|NaN|\[object Object\])$/.test(n.data.trim())) return n.data; return ''; });
  assert(!stray, `stray "${stray}" text at ${where}`);
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
  for (const h of ['scenes', 'talk', 'recall', 'games', 'home']) { await page.click(`#tabs a[data-tab="${h}"]`); await page.waitForTimeout(50); assert((await page.locator('#tabs a.on').getAttribute('data-tab')) === h, 'tab ' + h); }
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
    await noOverflow(page, 'role-play cue');
    await page.click('text=I said it. Show the line');
    await noOverflow(page, 'role-play reveal');
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

await test('a browser that accepts speech but stays silent is caught', { tts: false, scripts: ['window.__NO_CLIPS = true;', NO_MIC, SILENT_TTS] }, async (page) => {
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
  // the first recall card: an English cue, then a Chinese model taken from the scene just heard
  await page.waitForFunction(() => { const i = window.__spoken.map((x) => x.lang).lastIndexOf('en-US'); return i > 0 && window.__spoken[i + 1]; });
  const model = await page.evaluate(() => { const i = window.__spoken.map((x) => x.lang).lastIndexOf('en-US'); return window.__spoken[i + 1]; });
  assert(model.lang === 'zh-CN' && SCENES[0].chunks.some((c) => c.zh.replace(/[“”]/g, '') === model.text), 'English cue, then a phrase from the scene just heard; got ' + model.text);
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

await test('robotic system voices are never used', { scripts: [ROBOT_VOICES, FAKE_TTS, NO_MIC], tts: false }, async (page) => {
  await page.evaluate(() => { window.__CS_FAST = 80; window.__SPEAK_MS = 10; });
  await go(page, 'scene-s1');
  await page.click('.bigplay');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('chongshi.v1') || '{}').scenes?.s1?.listen, null, { timeout: 15000 });
  await go(page, 'ride');
  await page.click('.ride .btn.big');
  await page.waitForFunction(() => window.__spoken.some((s) => s.lang === 'en-US'), null, { timeout: 10000 });
  const used = [...new Set((await page.evaluate(() => window.__spoken)).map((s) => s.voice))];
  assert(used.every((v) => ['Tingting', 'Samantha'].includes(v)), 'only natural voices spoke, got ' + used.join(', '));
  await page.click('[aria-label="End ride"]');
  await page.goto(URL + '#home');
  await page.click('#gear');
  const listed = await page.$$eval('#voice option', (o) => o.map((x) => x.textContent));
  assert(listed.length === 1 && listed[0] === 'Tingting', 'settings lists only the natural voice, got ' + listed.join(', '));
});

await test('level check: scores bands, corrects for guessing, seeds the Words deck', {}, async (page) => {
  await page.evaluate(() => { window.__SPEAK_MS = 5; });
  assert(/Not measured yet/.test(await page.locator('.page').textContent()), 'home says the level is unmeasured');
  await page.click('text=Take the level check');
  await page.click('.level .primary');
  await page.waitForSelector('.card.test');
  let n = 0;
  let heardItems = 0;
  while (!(await page.locator('.summary.result').count())) {
    const listening = await page.locator('.card.test .bigplay').count();
    const w = listening ? (await page.evaluate(() => window.__spoken[window.__spoken.length - 1].text)) : await page.locator('.card.test .word-zh').textContent();
    const info = WORD.get(w);
    assert(info, 'word not in bank: ' + w);
    if (listening) { heardItems++; assert(!(await page.locator('.card.test .word-zh').isVisible()), 'characters hidden in a listening item'); }
    const opts = await page.$$eval('.level .opt', (els) => els.map((e) => e.textContent));
    assert(opts.length === 4 && new Set(opts).size === 4 && opts.includes(info.g), 'four distinct options including the right one');
    // know everything through HSK 5, nothing above
    if (info.lv <= 5) await page.locator('.level .opt').nth(opts.indexOf(info.g)).click(); else await page.click('.level .ghost');
    await page.locator('.card.test').click();
    n++;
    assert(n < 80, 'level check never ended');
  }
  assert(n === 56 && heardItems === 15, `56 items with 15 by ear, got ${n} and ${heardItems}`);
  const st = await state(page);
  const t = st.tests[0];
  assert(t.level === 5 && t.frontier === 6, `level 5, frontier 6; got ${t.level}/${t.frontier}`);
  assert(t.vocab === 2500, 'vocabulary estimate is the HSK 1-5 total, got ' + t.vocab);
  assert(t.missed === 22 && Object.keys(st.cards).filter((k) => k.startsWith('w:')).length === 22, 'the 22 missed words are in the deck');
  await page.click('text=Review missed words');
  await page.waitForSelector('.card.word');
  const first = await page.locator('.card.word .word-zh').textContent();
  assert(WORD.get(first).lv >= 6, 'the deck opens on a missed word');
  await page.click('text=Show answer');
  assert((await page.locator('.word-en').textContent()) === WORD.get(first).g, 'answer shows the gloss');
  await page.locator('.rate-btn').nth(2).click();
  await page.goto(URL + '#home');
  await page.reload();
  await page.waitForSelector('.level-row');
  assert((await page.locator('.level-row b').textContent()) === 'HSK 5', 'home shows the measured level after a reload');
});

await test('words deck without a level check starts at HSK 5 and can run by ear', {}, async (page) => {
  await go(page, 'recall-words');
  await page.waitForSelector('.card.word');
  const w = await page.locator('.card.word .word-zh').textContent();
  assert(WORD.get(w).lv === 5, 'first new word is HSK 5');
  await page.click('text=By ear');
  await page.waitForSelector('.card.word .bigplay');
  assert(!(await page.locator('.card.word .word-zh').count()), 'characters hidden by ear');
  await page.click('text=Show answer');
  await page.locator('.rate-btn').nth(2).click();
  const c = Object.entries((await state(page)).cards)[0];
  assert(c[0].startsWith('w:') && c[1].i === 30, 'a word known on sight goes 30 days out');
});

await test('conversation on a claude.ai page: turns, translation, hint, debrief, kept phrase', { scripts: [NO_MIC, FAKE_CLAUDE] }, async (page) => {
  await page.evaluate(() => { window.__SPEAK_MS = 5; });
  await page.click('#tabs a[data-tab="talk"]');
  await page.waitForSelector('.talk-card');
  assert((await page.locator('.talk-card').count()) === TALKS.length, 'all scenarios offered');
  await page.locator('.talk-card').first().click();
  await page.waitForSelector('.bub.them .bub-tools');
  assert((await plain(page.locator('.bub.them .zh'))) === '老师好！最近有点儿忙。您呢？', 'Claude opens in character');
  assert((await page.evaluate(() => window.__spoken.length)) > 0, 'the reply is spoken');
  assert(await page.locator('.orb').isHidden(), 'no mic control without a microphone');
  await page.fill('#talk-input', '我很高兴认识你');
  await page.press('#talk-input', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.bub.them .bub-tools').length === 2);
  const asked = await page.evaluate(() => window.__asked[window.__asked.length - 1]);
  assert(Array.isArray(asked) && asked[0].role === 'user' && /career advisor/.test(asked[0].content) && asked[asked.length - 1].role === 'user' && asked[asked.length - 1].content === '我很高兴认识你', 'instructions lead, the learner’s line ends the list');
  await page.locator('.bub-tools .tr').first().click();
  await page.waitForSelector('.bub .gloss');
  await page.click('text=Suggest a reply');
  await page.waitForFunction(() => /Not bad/.test(document.querySelector('.talk-hint').textContent));
  await page.fill('#talk-input', '还行');
  await page.click('.send');
  await page.waitForFunction(() => document.querySelectorAll('.bub.them .bub-tools').length === 3);
  await page.click('text=End and review');
  await page.waitForSelector('.summary.result');
  assert((await page.locator('.result .summary-sign b').textContent()) === 'HSK 5', 'debrief shows a level');
  await page.click('.fixes >> text=Keep');
  let st = await state(page);
  assert(st.mine.length === 1 && st.talks.length === 1, 'phrase kept and conversation logged');
  await page.goto(URL + '#recall');
  await page.reload();
  await page.waitForSelector('.card');
  assert((await page.locator('.cue-en').textContent()) === 'Take your time, no rush.', 'the kept phrase comes first in Recall');
  await page.click('#py');
  await page.click('text=Show answer');
  assert((await page.locator('.answer rt').count()) === 6, 'its pinyin lines up with its characters');
});

await test('conversation with an API key: setup, request shape, streamed reply', {}, async (page) => {
  let sent = null;
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    sent = { headers: route.request().headers(), body: JSON.parse(route.request().postData()) };
    const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body:
      ev({ type: 'message_start', message: {} }) + ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) + ev({ type: 'content_block_stop', index: 0 })
      + ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }) + ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '老师好！' } })
      + ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '我来早了吗？' } }) + ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + ev({ type: 'message_stop' }) });
  });
  await go(page, 'talk');
  await page.waitForSelector('#api-key');
  await page.locator('.talk-card').first().click();
  assert(await page.locator('.board, #api-key').first().isVisible(), 'without a connection a scenario does not start');
  await page.fill('#api-key', 'sk-ant-test');
  await page.click('.key-row >> text=Save');
  await page.waitForFunction(() => !document.querySelector('#api-key'));
  await page.locator('.talk-card').nth(1).click();
  await page.waitForSelector('.bub.them .bub-tools');
  assert((await plain(page.locator('.bub.them .zh'))) === '老师好！我来早了吗？', 'streamed text assembled');
  assert(sent.headers['x-api-key'] === 'sk-ant-test' && sent.headers['anthropic-version'] === '2026-10-21' && sent.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'headers');
  assert(sent.body.model === 'claude-opus-5-5' && sent.body.stream === true && sent.body.fallbacks === 'default' && sent.body.output_config.effort === 'low' && !('temperature' in sent.body), 'request body');
  assert(/浩然/.test(sent.body.system) && sent.body.messages[0].role === 'user', 'role in the system prompt; first message from the user');
  await go(page, 'recall');
  await page.click('text=Show answer');
  await page.locator('.rate-btn').nth(2).click();
  assert(!JSON.stringify(await state(page)).includes('sk-ant-test'), 'the key is kept out of saved progress and its backup code');
});

await test('conversation by voice: recognition loop', { scripts: [FAKE_SR, FAKE_CLAUDE] }, async (page) => {
  await page.evaluate(() => { window.__SPEAK_MS = 5; window.__SR_TEXT = '我也挺忙的'; });
  await go(page, 'talk-smalltalk');
  await page.waitForSelector('.bub.them .bub-tools');
  await page.click('.orb');
  await page.waitForFunction(() => document.querySelectorAll('.bub.me').length >= 1);
  assert((await page.locator('.bub.me .zh').first().textContent()) === '我也挺忙的', 'spoken reply recognised and sent');
  // after Claude answers, the mic reopens on its own
  await page.waitForFunction(() => document.querySelectorAll('.bub.me').length >= 2, null, { timeout: 8000 });
});

const GEN = { zh: '读博值不值', en: 'Is a PhD worth it', who: '思琪', setup: 'Siqi wonders whether to apply for a PhD.', culture: 'A doctorate carries prestige with parents.',
  lines: [['S', '老师，我在考虑要不要读博。', 'I am wondering whether to do a PhD.'], ['T', '你为什么想读博呢？', 'Why do you want to?'], ['S', '我爸妈觉得学历越高越好。', 'My parents think the higher the degree the better.'], ['T', '那你自己对研究感兴趣吗？', 'Are you interested in research yourself?'], ['S', '说实话，没那么感兴趣。', 'Honestly, not that much.'], ['T', '那就别勉强自己。', 'Then do not force yourself.']].map(([s, zh, en]) => ({ s, zh, en })),
  qs: [{ q: '思琪的父母怎么想？', right: '学历越高越好', wrong: ['不要读博', '马上工作'], why: '学历越高越好.' }, { q: '思琪对研究感兴趣吗？', right: '没那么感兴趣', wrong: ['非常感兴趣', '不知道'], why: '没那么感兴趣.' }],
  chunks: [['学历越高越好', 'The higher the degree, the better', '越…越…', '在父母眼里，|学历|越高|越好。', 'In parents eyes, the higher the degree the better.'], ['别勉强自己', 'Do not force yourself', 'Gentle.', '不想去|就|别勉强|自己。', 'If you do not want to go, do not force yourself.'], ['说实话', 'To be honest', 'Opener.', '说实话，|我|没|想好。', 'Honestly, I have not decided.'], ['随便坐。', 'duplicate of an authored phrase', '', 'x|y|z', 'x']].map(([zh, en, note, ex, exEn]) => ({ zh, en, note, ex, exEn })) };
const CLAUDE_WRITES = FAKE_CLAUDE.replace("/JSON object/.test(flat) ?", "/Write a short Mandarin dialogue/.test(flat) ? " + JSON.stringify(JSON.stringify(GEN)) + " : /JSON object/.test(flat) ?");

await test('Claude writes a new scene that plays like an authored one', { scripts: [NO_MIC, CLAUDE_WRITES] }, async (page) => {
  await page.evaluate(() => { window.__SPEAK_MS = 5; });
  await go(page, 'scenes');
  await page.click('text=Write me a new scene');
  await page.locator('.ideas .btn').first().click();
  await page.click('text=Write the scene');
  await page.waitForSelector('.steps');
  assert((await page.locator('#t-zh').textContent()) === GEN.zh, 'opens the new scene');
  await page.click('.steps button:nth-child(3)');
  assert((await page.locator('.chunks li').count()) === 3, 'three usable phrases; the duplicate of an authored one is dropped');
  await page.click('#py');
  await page.waitForFunction(() => document.querySelectorAll('.thread .bub rt').length > 20, null, { timeout: 8000 });
  const py = await page.locator('.thread .bub').first().locator('rt').allTextContents();
  assert(py.join(' ').startsWith('lǎo shī') && py.includes('bó'), 'pinyin added from the word bank: ' + py.join(' '));
  await go(page, 'scenes');
  assert((await page.locator('.line').count()) === 6 && (await page.locator('.station').count()) === SCENES.length + 1, 'it has its own line on the map');
  await page.reload();
  await page.waitForSelector('.station');
  assert((await page.locator('.station').count()) === SCENES.length + 1, 'and survives a reload');
});

// A claude.ai page with a private per-user document store shared by two "devices".
const CLOUD = `window.claude = { use: async (name) => {
  if (name === 'user') return { id: async () => 'u1' };
  if (name === 'db') return { doc: (path) => ({
    get: async () => { const v = await window.__cloudGet(path); return { exists: !!v, data: () => v }; },
    set: async (d) => { await window.__cloudSet(path, d); },
  }) };
  return null;
} };`;
await test('progress syncs between two devices and merges, not overwrites', {}, async () => {
  const cloud = {};
  const device = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(FAKE_TTS); await ctx.addInitScript(NO_MIC); await ctx.addInitScript(CLOUD);
    await ctx.exposeFunction('__cloudGet', (path) => cloud[path] || null);
    await ctx.exposeFunction('__cloudSet', (path, d) => { cloud[path] = d; });
    const p = await ctx.newPage();
    await p.goto(URL); await p.waitForSelector('.board');
    return p;
  };
  const rateOne = async (p, n) => { await go(p, 'recall'); for (let i = 0; i < n; i++) { await p.click('text=Show answer'); await p.locator('.rate-btn').nth(2).click(); } };
  const pushed = async (p) => { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(300); };
  const phone = await device();
  await rateOne(phone, 2);
  await phone.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); });
  await pushed(phone);
  assert(Object.keys(cloud)[0] === 'data/users/u1/progress', 'stored under the private per-user path');
  const laptop = await device();
  await laptop.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('chongshi.v1') || '{}').cards || {}).length === 2, null, { timeout: 8000 });
  await go(laptop, 'game-chengyu');
  await playRound(laptop, 'solve');
  await laptop.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); });
  await pushed(laptop);
  // back on the phone, which meanwhile did one more card offline
  await phone.click('text=Show answer'); await phone.locator('.rate-btn').nth(2).click();
  await phone.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
  await pushed(phone);
  const cards = Object.keys((await state(phone)).cards);
  assert(cards.length === 4 && cards.some((k) => k.startsWith('y:')), 'the phone holds its own three cards plus the idiom from the laptop, got ' + cards.length);
  await phone.context().close(); await laptop.context().close();
});

await test('children: meet the words, find the picture, take turns, earn stars', {}, async (page) => {
  await page.evaluate(() => { window.__SPEAK_MS = 5; });
  await page.click('.together');
  await page.waitForSelector('.ksets');
  assert((await page.locator('.ksets button').count()) === KIDS.sets.length, 'all picture sets shown');
  assert((await page.locator('.kwho button[aria-pressed="true"]').textContent()) === 'Both', 'both children play by default');
  const set = KIDS.sets[0];
  await page.locator('.ksets button').first().click();
  // meet each word; turns alternate
  const turns = [];
  for (let i = 0; i < set.words.length; i++) {
    await page.waitForSelector('.kcard');
    turns.push(await page.locator('.kturn').textContent());
    assert(await page.locator('.kcard rt').first().isVisible(), 'pinyin always shown for the grown-up');
    await page.click('.kids .primary');
  }
  assert(turns[0] === 'Kai' && turns[1] === 'Swae' && turns[2] === 'Kai', 'turns alternate: ' + turns.slice(0, 3).join(','));
  await page.click('text=找一找');
  let sizes = [];
  for (let n = 0; n < 8; n++) {
    await page.waitForFunction((k) => document.querySelectorAll('.kdots i.on').length === k && document.querySelector('.ktile'), n);
    const word = await plain(page.locator('.khear .zh'));
    sizes.push(await page.locator('.ktile').count());
    if (n === 0) { // a wrong tap is not punished: the tile wobbles and the round stays open
      await page.locator(`.ktile:not([data-word="${word}"])`).first().click();
      assert(await page.locator('.ktile.wobble').count(), 'wrong tile wobbles');
    }
    await page.click(`.ktile[data-word="${word}"]`);
  }
  await page.waitForSelector('.kstars');
  assert(sizes[0] === 2 && sizes[3] === 3 && sizes[7] === 4, 'choices grow from two to four: ' + sizes.join(''));
  let k = (await state(page)).kids;
  assert(k.p[0].stars === 1 && k.p[1].stars === 1, 'each child earned a star');
  assert(Object.keys(k.p[0].w).length + Object.keys(k.p[1].w).length === 8, 'finds are credited to whoever’s turn it was');
  // one child alone, memory pairs
  await page.click('text=Pick something else');
  await page.click('.kwho button >> nth=0');
  await page.locator('.ksets button').nth(1).click();
  for (let i = 0; i < KIDS.sets[1].words.length; i++) { await page.waitForSelector('.kcard'); await page.click('.kids .primary'); }
  await page.click('text=配对');
  await page.waitForSelector('.kflip');
  assert((await page.locator('.kflip').count()) === 12, 'six pairs');
  await noOverflow(page, 'pairs');
  // action game and the grown-up's phrases
  await go(page, 'kids-move');
  for (let i = 0; i < 8; i++) { await page.waitForSelector('.kcard'); await page.click('.kids .primary'); }
  await page.waitForSelector('.kstars');
  await go(page, 'kids-home');
  assert((await page.locator('.kline').count()) === 30, 'thirty routine phrases');
  await page.locator('.ktick').first().click();
  k = (await state(page)).kids;
  assert(k.said[KIDS.home[0].lines[0].zh] === 1 && k.p[0].stars === 2, 'phrase use and stars recorded');
  // rename a player; it survives a reload
  await go(page, 'kids');
  await page.locator('.kname').first().click();
  await page.fill('#kid-name', 'Kai-Kai');
  await page.click('text=Save');
  await page.reload();
  await page.waitForSelector('.ktrain');
  assert((await page.locator('.kname').first().textContent()) === 'Kai-Kai', 'name kept');
  for (const h of ['kids', 'kids-set-colors', 'kids-set-numbers', 'kids-home']) { await go(page, h); await noOverflow(page, h); }
});

await test('recorded lines play from audio files, with the device voice for everything else', { scripts: ['window.__WITH_CLIPS = true;', FAKE_TTS, NO_MIC], tts: false }, async (page) => {
  const sc = SCENES[0];
  const recorded = sc.lines.filter((l) => CLIPS[l.zh]);
  assert(recorded.length >= 5, 'scene one has recordings');
  await page.evaluate(() => {
    window.__played = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (!this.src.startsWith('data:')) window.__played.push({ at: +this.currentTime.toFixed(2), rate: this.playbackRate }); return play.call(this); };
  });
  await go(page, 'scene-' + sc.id);
  await page.click('.steps button:nth-child(3)');
  const first = sc.lines.findIndex((l) => CLIPS[l.zh]);
  await page.locator('.thread .bub').nth(first).click();
  await page.waitForFunction(() => window.__played.length === 1, null, { timeout: 8000 });
  const p = await page.evaluate(() => window.__played[0]);
  assert(Math.abs(p.at - CLIPS[sc.lines[first].zh][1]) < 0.05, `seeks to the line: ${p.at} vs ${CLIPS[sc.lines[first].zh][1]}`);
  assert((await page.evaluate(() => window.__spoken.length)) === 0, 'the device voice stays silent for a recorded line');
  const dur = await page.evaluate(() => document.createElement('audio').canPlayType('audio/mpeg'));
  assert(dur !== '', 'browser can decode the recordings');
  await page.locator('.chunks .say').first().click(); // phrases not recorded yet fall back to the device voice, recorded ones play
  await page.waitForFunction(() => window.__played.length + window.__spoken.length === 2, null, { timeout: 8000 });
});

for (const [w, hgt] of [[360, 640], [390, 844], [768, 1024], [1280, 800]]) {
  await test(`layout ${w}×${hgt}: no sideways scroll, controls reachable`, { viewport: { width: w, height: hgt } }, async (page) => {
    await page.click('#py');
    for (const h of ['home', 'scenes', 'scene-s14', 'recall', 'recall-words', 'level', 'talk', 'compose', 'games', 'game-weave', 'game-dictation', 'game-chengyu', 'game-register', 'ride']) {
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
