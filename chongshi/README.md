# 重拾 Chóngshí

A Mandarin reactivation app for one particular learner: someone who once spoke it well (college study, two years in
Shanghai), has barely used it in a decade, and now advises business-analytics students, many of them from China.
The goal is natural conversation about student life, job hunting, interviews and analytics. It is built for a
one-hour train commute a few times a week.

It is a static site with no build step and no runtime dependencies. Open it on a phone or a laptop; it works
offline after the first load and can be added to the home screen.

## What a ride looks like

| | When | What happens |
|---|---|---|
| **耳机模式 Ears-only ride** | Standing, walking, eyes busy | Hands-free loop: a scene at natural speed, spoken questions, then English cue → silence to answer aloud → the Chinese → silence to shadow it. Then the same scene again and you shadow the advisor's lines. 10, 20 or 30 minutes. Two big optional buttons mark a phrase as blanked or known. |
| **坐着学 Seated ride** | Seated with the screen | One tap chains three legs: the next scene, a mixed puzzle run, then Recall of the phrases you just met. |
| **场景 Scenes** | Any time | 14 advising conversations on five "lines". Each has four steps: listen with the text hidden, answer inference questions in Chinese, read the transcript with notes on usage and culture, then play the advisor yourself. |
| **复习 Recall** | Any time | Spaced review. English cue, you produce the Chinese (the mic scores it if available), then rate how it came back. |
| **游戏 Puzzles** | Any time | 听写 dictation with homophone decoy tiles, 连句 sentence weave, 成语 idiom match, 分寸 register choices. |

Content: 108 phrases, 14 scenes, 35 idioms, 18 register situations. Every phrase is one the advisor would say or
needs to understand, including current student slang (卷, 躺平, 搭子, 社恐, 上岸, 复盘).

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

Progress lives in the browser's local storage on each device. Settings → "Copy my code" exports it as text;
paste it on another device to restore.

## Adding content

Edit `content/content.mjs`, then regenerate:

```bash
npm run content
```

The generator adds pinyin for every Chinese string and builds the homophone table. Add `--review` to
`node tools/build-content.mjs` to print how each polyphonic character was read, and force a reading with
`字{pīnyīn}` in the source where it is wrong.

## Tests

```bash
npm test
```

Runs 18 end-to-end checks in headless Chromium against the local server (start `npm run serve` first): every
mode played to completion, scheduling, persistence across reloads, the speech fallbacks, the hands-free ride's
sequencing, and layout at four screen sizes. Speech synthesis is stubbed, so real audio output is not covered.

## Layout

```
index.html, app.css      shell and styles
js/main.js               router, home, settings
js/store.js              saved state and the spaced-repetition scheduler
js/audio.js              speech out, speech in, recording, sound effects
js/scene.js recall.js games.js ride.js journey.js   the modes
js/content.gen.js        generated from content/content.mjs
sw.js                    offline cache
```
