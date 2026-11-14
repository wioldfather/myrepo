# 重拾 Chóngshí

A Mandarin reactivation app for one particular learner: someone who once spoke it well (college study, two years in
Shanghai), has barely used it in a decade, and now advises business-analytics students, many of them from China.
The goal is natural conversation about student life, job hunting, interviews and analytics. It is built for a
one-hour train commute a few times a week.

It is a static site with no build step and no runtime dependencies. Open it on a phone or a laptop; it works
offline after the first load and can be added to the home screen.

## What is in it

| | When | What happens |
|---|---|---|
| **耳机模式 Ears-only ride** | Standing, walking, eyes busy | Hands-free loop: a scene at natural speed, spoken questions, then English cue → silence to answer aloud → the Chinese → silence to shadow it. Then the same scene again and you shadow the advisor's lines. 10, 20 or 30 minutes. |
| **坐着学 Seated ride** | Seated with the screen | One tap chains three legs: the next scene, a mixed puzzle run, then Recall of the phrases you just met. |
| **对话 Talk** | Any time you can speak or type | Live conversation with Claude playing a student, a parent or an alum in 11 scenarios from your work, or one you describe. Ends with a debrief: corrections, a speaking estimate, and phrases you can keep in Recall. |
| **场景 Scenes** | Any time | 18 advising conversations on five "lines". Each has four steps: listen with the text hidden, answer inference questions in Chinese, read the transcript with notes on usage and culture, then play the advisor yourself. Claude can write new ones on any topic. |
| **复习 Recall** | Any time | Two decks on one scheduler. Phrases: an English cue, you produce the Chinese. Words: 7,900 graded words (HSK 1–6 plus the 7–9 band), by eye or by ear. |
| **水平 Level check** | Every few weeks | Six minutes, 56 sampled words by eye and by ear, corrected for guessing. Reports how much of each HSK band is still there and a vocabulary estimate, and points the Words deck at the first band with gaps. |
| **游戏 Puzzles** | Any time | 听写 dictation with homophone decoy tiles, 连句 sentence weave, 成语 idiom match, 分寸 register choices. |

Authored content: 141 phrases, 18 scenes, 35 idioms, 18 register situations. Every phrase is one the advisor
would say or needs to understand, including current student slang (卷, 躺平, 搭子, 社恐, 上岸, 复盘).

## Why it is built this way

The design follows what is known about recovering a language that has attrited, which is a different problem
from learning one.

- **Retrieval, not review.** What decays first is access, not knowledge. Every exercise makes you produce the
  Chinese before you see it. Recognition-only drills are left out.
- **Savings.** Relearning is far faster than learning. A phrase answered instantly on first sight is pushed ten
  days out; one that took effort returns in three days; a blank returns tomorrow. A later lapse on an
  established phrase keeps a quarter of its interval. Time goes to what is actually rusty.
- **Chunks in context.** Idiomatic speech is made of ready-made sequences. The unit is a full phrase from a
  conversation, and Recall introduces a phrase only after you have met it in its scene.
- **Natural-speed input, heard twice.** Scenes play at full speed with the text hidden, with a second voice for
  the student. The ears-only ride replays each scene after its phrases have been drilled.
- **Pushed output.** Role-play shows only an English cue for your lines. You have to say the line before you
  see it. Shadowing follows the model.
- **Pragmatics.** Register items and scene notes cover how to soften criticism, deflect a compliment, decline
  politely, and what 还行吧 really means.

## Audio and microphone

Speech uses the Web Speech API built into the browser, so the voice is whichever Mandarin voice the device has.
The app checks at runtime and falls back in steps:

| Capability | Used for | If missing |
|---|---|---|
| Mandarin text-to-speech voice | All listening, the ears-only ride | Scenes go straight to the transcript, dictation shows pinyin, the ride explains why it cannot start |
| Live speech recognition (Chrome, Safari; needs a connection) | Scores what you said, tolerant of homophones | Falls back to recording |
| Microphone recording | Record yourself, compare by ear with the model | Falls back to say-it-aloud and self-check |

Phones stop speaking when they lock, so the ride keeps the screen awake while it runs.

## Live conversation and Claude

Talk, new scenes and the "in a sentence" button on word cards need Claude. There are two ways to connect:

- **On the app's claude.ai page** it uses the viewer's own Claude plan. Nothing to set up. On desktop Chrome
  it also uses Claude's voice and dictation; elsewhere it uses the device voice and typed or keyboard-dictated
  replies.
- **Anywhere else** (the installed app, GitHub Pages), paste a Claude API key on the Talk screen. The key is
  stored in that browser only, kept out of the progress backup, and sent only to `api.anthropic.com`. Requests
  go straight from the browser to the Messages API (`claude-opus-5-5`, streamed, low effort for live turns,
  server-side refusal fallbacks enabled). With browser speech recognition this gives a hands-free voice loop.

Without either, each scenario can be copied as a prompt for Claude's own voice mode.

## Run it

```bash
npm install
```

```bash
npm run serve
```

Then open http://localhost:4173. `npm install` is only needed for the content generator and the tests; the app
itself is the files in this folder.

To put it on your phone, host the folder anywhere static. With GitHub Pages: repository Settings → Pages →
Deploy from a branch → pick the branch and `/ (root)`. The app is then at
`https://<user>.github.io/<repo>/chongshi/`. Open it once online, then "Add to Home Screen".

## Progress

Progress lives in the browser's local storage. On the claude.ai page it also syncs to a private per-user
document, so a phone and a laptop stay in step; the two copies are merged, not overwritten. Elsewhere,
Settings → "Copy my code" exports progress as text to paste on another device.

## Adding content

Edit `content/content.mjs`, then regenerate:

```bash
npm run content
```

The generator adds pinyin for every Chinese string and builds the homophone table. The graded word bank is
built separately from the Complete HSK Vocabulary dataset:

```bash
node tools/build-words.mjs path/to/complete.min.json
```
 Add `--review` to
`node tools/build-content.mjs` to print how each polyphonic character was read, and force a reading with
`字{pīnyīn}` in the source where it is wrong.

## Tests

```bash
npm test
```

Runs 26 end-to-end checks in headless Chromium against the local server (start `npm run serve` first): every
mode played to completion, scheduling, persistence across reloads, the speech fallbacks, the hands-free ride's
sequencing, the level check, both conversation back ends, scene writing, two-device sync, and layout at
four screen sizes. Speech and Claude are stubbed, so real audio and real model replies are not covered.

## Credits

- Word lists and frequency ranks: [Complete HSK Vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) by Yanis Zafirópulos, MIT.
- Definitions in the word bank: [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict), CC BY-SA 4.0.
  `js/words.gen.js` is a derivative of it and carries the same licence.

## Layout

```
index.html, app.css      shell and styles
js/main.js               router, home, settings
js/store.js              saved state and the spaced-repetition scheduler
js/audio.js              speech out, speech in, recording, sound effects
js/scene.js recall.js games.js ride.js journey.js   the modes
js/level.js talk.js compose.js                      level check, live conversation, scene writing
js/llm.js sync.js        Claude access; progress sync on the claude.ai page
js/content.gen.js        generated from content/content.mjs
js/words.gen.js          generated word bank (loaded on demand)
sw.js                    offline cache
```
