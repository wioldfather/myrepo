// 对话: live conversation with Claude in a scenario from the learner's work.
// Voice in:  browser speech recognition (hands-free loop) → Claude dictation on a claude.ai page (tap per turn) → typing.
// Voice out: Claude's own voice on a claude.ai page where offered → the device's Mandarin voice → text only.
// It ends with a debrief: corrections, an estimate of speaking level, and phrases that can be kept in the Recall deck.
import { TALKS } from './content.gen.js';
import * as store from './store.js';
import { speak, stop, sfx, canSpeak, speechMode, listen } from './audio.js';
import { h, zh, icon, go, button, toast } from './ui.js';
import { backend, ask, askJson, capability, setApiKey, MESSAGES } from './llm.js';

let customBrief = ''; // the learner's own scenario, carried from the hub to the session

const bandName = (lv) => (lv >= 7 ? 'HSK 7–9' : lv <= 2 ? 'HSK 3' : 'HSK ' + lv);

function instructions(role) {
  const tests = store.tests();
  const level = tests.length
    ? `Their reading vocabulary currently tests at about ${bandName(tests[tests.length - 1].level)}. Their speaking is rustier than their comprehension.`
    : 'Assume their comprehension is around HSK 5 and their speaking is rustier than that.';
  const practising = store.CHUNKS.filter((c) => store.card(c.id)).sort((a, b) => store.card(a.id).d - store.card(b.id).d).slice(0, 8).map((c) => c.zh);
  return [
    'This is a spoken Mandarin practice conversation. You play a character; the learner plays themselves.',
    'The learner is an American university career advisor who works with business-analytics master\'s students, many of them from China. They studied Mandarin in college and lived in Shanghai for two years, but have barely used it for a decade and are bringing it back. ' + level,
    'Your character: ' + role,
    'How to speak:',
    '- Natural, colloquial Mainland Mandarin in simplified characters, the way this person would really talk. One to three short sentences per turn. This is speech, not writing.',
    '- Chinese only. No pinyin, no English, no markdown, no emoji, no stage directions, nothing in brackets. Your words are read aloud by a speech engine.',
    '- Stay in character. React to what they said, then give them something to respond to: a question, a worry, a new detail.',
    '- Do not correct or comment on their Chinese. If a sentence was wrong but understandable, carry on, and where it fits, use the right form yourself in your reply.',
    '- Their words reach you through speech recognition or typing, so expect wrong characters that sound like the intended word. Work out what they meant.',
    '- If they say they did not understand, in Chinese or in English, say the same thing again in simpler words.',
    practising.length ? '- They are currently reviewing these phrases. If one fits naturally, use it or give them an opening to use it: ' + practising.join(' / ') : '',
  ].filter(Boolean).join('\n');
}

function roleFor(arg) {
  const t = TALKS.find((x) => x.id === arg);
  if (t) return { zh: t.zh, en: t.en, brief: t.brief, role: t.role, who: (t.role.match(/^You are ([\u4e00-\u9fff]+)/) || [])[1] || t.zh };
  const sc = store.sceneById(arg);
  if (sc && sc.lines) {
    return {
      zh: sc.zh, en: sc.en, brief: sc.setup, who: sc.who,
      role: `You are ${sc.who}, the student in this situation: ${sc.setup} Have this conversation afresh, in your own words, and let it go wherever it goes. Do not recite a script. For reference, one version of it went like this:\n${sc.lines.map((l) => (l.s === 'T' ? 'Advisor: ' : 'Student: ') + l.zh).join('\n')}`,
    };
  }
  if (arg === 'custom' && customBrief) return { zh: '我的情景', en: 'My own situation', brief: customBrief, who: '对方', role: `The learner described the situation they want to rehearse: "${customBrief}". Play the other person in it, and start the conversation the way that person would.` };
  return null;
}

/* ---------- hub ---------- */
export function talkHub() {
  const el = h('div', { class: 'page' }, h('p', { class: 'note' }, 'Checking the connection to Claude…'));
  let alive = true;

  async function paint() {
    const how = await backend();
    if (!alive) return;
    const last = store.talks()[store.talks().length - 1];
    const card = (t) => h('button', { class: 'game-card talk-card', type: 'button', onclick: () => (how ? go('talk-' + t.id) : copyPrompt(t)) },
      h('span', { class: 'game-text' }, h('b', { lang: 'zh-CN' }, t.zh), h('span', null, t.brief)),
      h('span', { class: 'game-best' }, how ? t.en : 'Copy as a prompt'));
    const own = h('textarea', { id: 'own-scenario', rows: 2, placeholder: 'Describe a conversation you have coming up, in English or Chinese', 'aria-label': 'Your own scenario' });
    const key = h('input', { id: 'api-key', type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…', 'aria-label': 'Claude API key' });

    el.replaceChildren(
      how ? null : h('section', { class: 'panel' },
        h('h2', null, h('span', { lang: 'zh-CN' }, '连接'), ' Connect Claude'),
        h('p', null, 'Live conversation needs Claude. Two ways to get it:'),
        h('ul', { class: 'bullets' },
          h('li', null, 'Open this app from its claude.ai page. It then uses your Claude plan with nothing to set up.'),
          h('li', null, 'Or paste a Claude API key here. It is stored in this browser only and sent only to Anthropic.')),
        h('div', { class: 'key-row' }, key, button('Save', 'primary', () => {
          if (!key.value.trim()) return toast('Paste a key first');
          setApiKey(key.value);
          paint();
        })),
        h('p', { class: 'note' }, 'Until then, tapping a scenario copies it as a prompt. Paste it into the Claude app and switch on voice mode.')),
      how && last ? h('p', { class: 'note' }, `Last conversation: ${last.level}${last.hskk ? ' · HSKK ' + last.hskk : ''}, ${new Date(last.t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.`) : null,
      h('div', { class: 'game-list' }, TALKS.map(card)),
      how ? h('section', { class: 'panel' },
        h('h2', null, h('span', { lang: 'zh-CN' }, '自定义'), ' Rehearse something real'),
        own,
        h('div', { class: 'actions' }, button('Start this conversation', 'primary', () => {
          if (own.value.trim().length < 8) return toast('Describe the situation in a sentence');
          customBrief = own.value.trim();
          go('talk-custom');
        }, 'arrow'))) : null);
  }
  async function copyPrompt(t) {
    const text = instructions(t.role) + '\n\nStart the conversation now with your first line, in character. When I say "结束", step out of character and tell me, in English, three things to fix in my Chinese and three phrases worth keeping.';
    try { await navigator.clipboard.writeText(text); toast('Prompt copied. Paste it into Claude and start voice mode.'); } catch { toast('Copying is blocked here. Set up a connection instead.'); }
  }
  paint();
  return { el, title: '对话', sub: 'Talk · live conversation with Claude', destroy: () => { alive = false; } };
}

/* ---------- one conversation ---------- */
export function talkView(arg) {
  const sc = roleFor(arg);
  if (!sc) return talkHub();
  const system = instructions(sc.role);
  const turns = []; // starts with Claude's opening line
  const thread = h('div', { class: 'thread talk-thread' });
  const status = h('div', { class: 'talk-status', 'aria-live': 'polite' });
  const micBtn = h('button', { class: 'orb', type: 'button', 'aria-label': 'Speak' }, icon('mic'));
  const input = h('input', { id: 'talk-input', type: 'text', lang: 'zh-CN', autocomplete: 'off', enterkeyhint: 'send', placeholder: '打字，或用键盘上的听写键', 'aria-label': 'Your reply' });
  const sendBtn = h('button', { class: 'say send', type: 'button', 'aria-label': 'Send' }, icon('arrow'));
  const hintBox = h('p', { class: 'talk-hint', hidden: true });
  const dock = h('div', { class: 'talk-dock' });
  const el = h('div', { class: 'page talk' }, h('p', { class: 'setup' }, sc.brief), thread, dock);

  let alive = true;
  let phase = 'idle'; // thinking · speaking · listening · idle · review
  let ctl = null; // AbortController for the call in flight
  let stopListening = null;
  let auto = false; // keep the mic loop going once the learner has answered by voice
  let misses = 0;
  let voice = null; // Claude's own voice, where the page offers it
  let voiceOff = false;
  let dict = null; // Claude dictation, where the page offers it
  let heard = '';
  let quiet = null;
  let say = 0; // bumped to cancel speech in progress
  let bank = null; // the word bank, once loaded, supplies pinyin for what Claude says
  store.loadWords().then((b) => { bank = b; }).catch(() => {});

  const setPhase = (p, text) => {
    phase = p;
    el.dataset.phase = p;
    status.textContent = text || { thinking: '…', speaking: sc.who + ' …', listening: 'Listening…', idle: voiceIn() ? 'Tap the mic to answer, or type' : 'Type your answer' }[p] || '';
    micBtn.replaceChildren(icon(p === 'listening' ? 'pause' : 'mic'));
  };
  const voiceIn = () => (dict ? 'dictation' : speechMode() === 'sr' ? 'sr' : null);
  const scroll = () => dock.scrollIntoView({ block: 'end', behavior: 'smooth' });

  function bubble(who, text) {
    const body = h('span', { class: 'zh', lang: 'zh-CN' }, text);
    const b = h('div', { class: 'bub ' + (who === 'me' ? 'me' : 'them') }, h('small', { class: 'who', lang: 'zh-CN' }, who === 'me' ? '你' : sc.who), body);
    thread.append(b);
    scroll();
    return { b, body };
  }

  /* --- speaking Claude's reply --- */
  async function sayAll(text) {
    const mine = ++say;
    if (voice && !voiceOff) {
      try { await voice.speak(text, { language: 'zh' }); return; } catch (e) {
        if (e && e.code === 'stopped') return;
        if (e && e.code === 'not_granted') { voiceOff = true; return; } // the viewer turned reading aloud off: respect it
      }
    }
    if (!canSpeak()) return;
    for (const part of text.match(/[^。！？!?\n]+[。！？!?\n]*/g) || [text]) {
      if (mine !== say || !alive) return;
      if (part.trim()) await speak(part.trim(), { alt: true });
    }
  }
  function hush() {
    say++;
    stop();
    if (voice) voice.stop().catch(() => {});
  }

  /* --- Claude's turn --- */
  async function claudeTurn() {
    hintBox.hidden = true;
    setPhase('thinking');
    const { b, body } = bubble('them', '…');
    ctl = new AbortController();
    let text;
    try {
      text = await ask({ system, turns, quick: true, signal: ctl.signal, onText: (t) => { body.textContent = t; } });
    } catch (e) {
      b.remove();
      if (!alive || e.code === 'cancelled') return;
      setPhase('idle', MESSAGES[e.code] || MESSAGES.failed);
      dock.querySelector('.retry').hidden = false;
      return;
    }
    if (!alive) return;
    text = text.trim();
    // Pinyin for Claude's reply, from the word bank, so the 拼 toggle works here too.
    if (bank) { store.annotate(text, bank); body.replaceWith(zh(text)); } else body.textContent = text;
    turns.push({ role: 'assistant', content: text });
    b.append(h('span', { class: 'bub-tools' },
      h('button', { type: 'button', 'aria-label': 'Play again', onclick: () => { hush(); sayAll(text); } }, icon('sound')),
      h('button', { type: 'button', class: 'tr', onclick: (e) => translate(text, b, e.currentTarget) }, 'EN')));
    setPhase('speaking');
    await sayAll(text);
    if (!alive || phase !== 'speaking') return;
    setPhase('idle');
    if (auto && voiceIn() === 'sr') startListening();
  }

  async function translate(text, b, btn) {
    btn.disabled = true;
    const out = h('span', { class: 'en gloss' }, '…');
    b.append(out);
    try {
      out.textContent = await ask({ quick: true, system: `Translate this Mandarin line into natural English on the first line. Then, on separate lines, list up to three words in it that a rusty advanced learner may have forgotten, each as: word (pinyin) meaning. Plain text only, no markdown.\n\n${text}` });
    } catch (e) { out.textContent = MESSAGES[e.code] || MESSAGES.failed; btn.disabled = false; }
    scroll();
  }

  /* --- the learner's turn --- */
  function userTurn(text) {
    text = text.trim();
    if (!alive || !text || phase === 'thinking' || phase === 'review') return;
    hush();
    input.value = '';
    bubble('me', text);
    turns.push({ role: 'user', content: text });
    claudeTurn();
  }

  function startListening() {
    if (phase === 'thinking' || phase === 'review') return;
    hush();
    sfx('cue');
    if (voiceIn() === 'dictation') {
      heard = '';
      setPhase('listening');
      // Must be called straight from the tap: the platform asks for the microphone itself.
      dict.start({ language: 'zh' }).catch((e) => {
        if (!alive) return;
        if (e && (e.code === 'unavailable' || e.code === 'not_granted')) dict = null;
        setPhase('idle', dict ? 'Tap the mic to try again, or type' : 'Dictation is not available here. Type your answer.');
        micBtn.hidden = !voiceIn();
      });
      stopListening = () => { clearTimeout(quiet); dict.stop().catch(() => {}).then(() => { stopListening = null; if (heard.trim()) userTurn(heard); else setPhase('idle'); }); };
      return;
    }
    setPhase('listening');
    const l = listen((t) => { status.textContent = t || 'Listening…'; });
    stopListening = l.stop;
    l.promise.then((res) => {
      stopListening = null;
      if (!alive || phase !== 'listening') return;
      if (res.text) { auto = true; misses = 0; return userTurn(res.text); }
      // Nothing heard: try once more on its own, then hand the loop back to the learner.
      if (speechMode() === 'sr' && auto && ++misses < 2) return startListening();
      auto = false;
      micBtn.hidden = !voiceIn();
      setPhase('idle', voiceIn() ? 'Didn’t catch that. Tap the mic or type.' : 'The microphone is not available here. Type your answer, or use your keyboard’s dictation key.');
    });
  }
  micBtn.onclick = () => (phase === 'listening' && stopListening ? stopListening() : startListening());
  sendBtn.onclick = () => userTurn(input.value);
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); userTurn(input.value); } };

  async function hint() {
    if (!turns.length) return;
    hintBox.hidden = false;
    hintBox.textContent = '…';
    try {
      hintBox.textContent = await ask({ quick: true, system: `In this Mandarin practice conversation the learner (the advisor) is stuck. Suggest two short, natural things they could say next. Give each on its own line as: the Chinese, then its English in brackets. Plain text only.\n\n${transcript()}` });
    } catch (e) { hintBox.textContent = MESSAGES[e.code] || MESSAGES.failed; }
    scroll();
  }
  const transcript = () => turns.map((t) => (t.role === 'user' ? 'Advisor: ' : sc.who + ': ') + t.content).join('\n');

  /* --- debrief --- */
  async function review() {
    const mine = turns.filter((t) => t.role === 'user').length;
    hush();
    if (ctl) ctl.abort();
    if (stopListening) stopListening();
    if (mine < 2) return go('talk');
    setPhase('review');
    dock.replaceChildren(h('p', { class: 'note' }, 'Claude is reviewing the conversation…'));
    scroll();
    let r;
    try {
      r = await askJson(`You are reviewing a Mandarin speaking-practice conversation. The learner is the "Advisor": a formerly advanced speaker reactivating the language after ten years. Their lines came through speech recognition or typing, so ignore wrong characters that sound the same as the intended word.

${transcript()}

Reply with only a JSON object in this shape:
{"level":"HSK 3 | HSK 4 | HSK 5 | HSK 6 | HSK 7-9 (the band their spoken Chinese in this conversation most resembles)","hskk":"初级 | 中级 | 高级","summary":"two plain English sentences: what they did well, then the one thing to work on next","fixes":[{"said":"their words","better":"a more natural way to say it","why":"the reason, in English, under 15 words"}],"phrases":[{"zh":"a phrase worth keeping","pinyin":"tone-marked pinyin, one syllable per character, separated by spaces","en":"its meaning in English","note":"when to use it, under 12 words"}]}
Give at most five fixes, only for real errors or clearly unnatural phrasing; an empty list is fine. Give three to five phrases, taken from the conversation or ones that would have helped the learner in it.`);
    } catch (e) {
      if (!alive) return;
      dock.replaceChildren(h('p', { class: 'note warn' }, MESSAGES[e.code] || MESSAGES.failed), h('div', { class: 'actions' }, button('Try the review again', 'primary', review), button('Leave', 'ghost', () => go('talk'))));
      return;
    }
    if (!alive) return;
    const fixes = Array.isArray(r.fixes) ? r.fixes.filter((f) => f && f.said && f.better).slice(0, 5) : [];
    const phrases = Array.isArray(r.phrases) ? r.phrases.filter((p) => p && p.zh && p.en).slice(0, 5) : [];
    store.saveTalk({ t: Date.now(), level: String(r.level || '').slice(0, 12), hskk: String(r.hskk || '').slice(0, 4), turns: mine });
    store.addKm(5 + mine);
    store.markDay();
    sfx('done');
    dock.replaceChildren(h('section', { class: 'summary result' },
      h('div', { class: 'summary-sign' }, h('b', null, String(r.level || '对话')), h('span', null, `Speaking estimate${r.hskk ? ' · HSKK ' + r.hskk : ''} · ${mine} turns`)),
      r.summary ? h('p', { class: 'summary-note lead' }, String(r.summary)) : null,
      fixes.length ? h('h3', null, 'Say it better') : null,
      h('ul', { class: 'fixes' }, fixes.map((f) => h('li', null,
        h('span', { class: 'said', lang: 'zh-CN' }, String(f.said)),
        h('button', { class: 'better', type: 'button', lang: 'zh-CN', onclick: () => speak(String(f.better)) }, String(f.better)),
        h('span', { class: 'why' }, String(f.why || ''))))),
      phrases.length ? h('h3', null, 'Worth keeping') : null,
      h('ul', { class: 'fixes' }, phrases.map((p) => {
        const add = button('Keep', 'chip', () => {
          const ok = store.addMine({ zh: String(p.zh), py: String(p.pinyin || ''), en: String(p.en), note: String(p.note || '') });
          add.disabled = true;
          add.lastChild.textContent = ok ? 'In your deck' : 'Already there';
        });
        return h('li', null,
          h('button', { class: 'better', type: 'button', lang: 'zh-CN', onclick: () => speak(String(p.zh)) }, String(p.zh)),
          h('span', { class: 'why' }, String(p.en), p.note ? ' · ' + String(p.note) : ''), add);
      })),
      h('p', { class: 'summary-note small' }, 'The level is one conversation’s impression, not a test score. Phrases you keep show up in Recall.'),
      h('div', { class: 'actions' }, button('Another conversation', 'primary', () => go('talk'), 'arrow'), button('Back to today', 'ghost', () => go('home')))));
    scroll();
  }

  /* --- wire up --- */
  const retry = button('Try again', 'ghost retry', () => { retry.hidden = true; claudeTurn(); }, 'again');
  retry.hidden = true;
  dock.append(
    hintBox,
    h('div', { class: 'talk-main' }, micBtn, status),
    h('div', { class: 'talk-type' }, input, sendBtn),
    h('div', { class: 'actions' }, retry, button('Suggest a reply', 'ghost', hint), button('End and review', 'ghost', review)));
  micBtn.hidden = !voiceIn();

  (async () => {
    // A claude.ai page may offer Claude's voice and dictation; both are absent on phones and outside Claude.
    const [v, d] = await Promise.all([capability('tts'), capability('dictation')]);
    if (!alive) return;
    voice = v;
    if (d) {
      dict = d;
      d.onFinal(({ text }) => { heard += text; status.textContent = heard.trim(); restartQuiet(); });
      d.onPartial(({ text }) => { if (text) { status.textContent = (heard + ' ' + text).trim(); restartQuiet(); } });
      micBtn.hidden = false;
    }
    claudeTurn();
  })();
  // In dictation there is no end-of-speech signal, so a pause of two seconds ends the turn.
  function restartQuiet() {
    clearTimeout(quiet);
    quiet = setTimeout(() => { if (phase === 'listening' && stopListening) stopListening(); }, 2000);
  }

  return {
    el, title: sc.zh, sub: sc.en, back: 'talk',
    destroy: () => {
      alive = false;
      clearTimeout(quiet);
      hush();
      if (ctl) ctl.abort();
      if (stopListening) stopListening();
    },
  };
}
