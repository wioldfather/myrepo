// Finds where each line starts and ends inside one recording of several lines read in order.
// The recording has no markers, only natural pauses, and a pause between two lines is not reliably longer
// than a pause between two sentences of one line. So: detect every pause, then choose the set of pauses whose
// segment lengths best match what each line's text predicts (dynamic programming), with a preference for
// longer pauses. Exports align(file, lines) → [{start, end}] in seconds, plus a per-line plausibility score.
import { execFileSync } from 'node:child_process';

const HAN = /[一-鿿]/g;
// Rough speaking weight of a line: characters, plus pauses at punctuation, plus Latin words.
export const weight = (s) => (s.match(HAN) || []).length + (s.match(/[A-Za-z]+/g) || []).length * 1.6 + (s.match(/[，、：；]/g) || []).length * 0.9 + (s.match(/[。！？…]/g) || []).length * 1.8 + 0.8;

function probe(file) {
  const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  let log = '';
  try { execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-36dB:d=0.16', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }); } catch (e) { log = String(e.stderr || ''); }
  if (!log) log = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af silencedetect=noise=-36dB:d=0.16 -f null - 2>&1`], { encoding: 'utf8' });
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const pauses = starts.map((s, i) => ({ s: Math.max(0, s), e: ends[i] ?? dur })).filter((p) => p.e > p.s);
  return { dur, pauses };
}

export function align(file, lines) {
  const { dur, pauses } = probe(file);
  // speech begins after any leading silence and ends before any trailing one
  const lead = pauses.length && pauses[0].s < 0.05 ? pauses.shift().e : 0;
  const tail = pauses.length && pauses[pauses.length - 1].e > dur - 0.05 ? pauses.pop().s : dur;
  const n = lines.length;
  if (pauses.length < n - 1) throw new Error(`only ${pauses.length} pauses for ${n} lines in ${file}`);
  const w = lines.map(weight);
  const total = w.reduce((a, b) => a + b, 0);
  const speech = tail - lead;
  const want = w.map((x) => (x / total) * speech);
  // cut[k] = pause used after line k. cost: squared relative error of each line's length, minus a reward for long pauses
  const P = pauses.length;
  const INF = 1e18;
  const cost = Array.from({ length: n }, () => new Float64Array(P + 1).fill(INF));
  const back = Array.from({ length: n }, () => new Int32Array(P + 1).fill(-1));
  const segCost = (from, to, i) => { const d = to - from; return d <= 0.15 ? INF : ((d - want[i]) ** 2) / want[i]; };
  for (let p = 0; p < P; p++) cost[0][p] = segCost(lead, pauses[p].s, 0) - 1.2 * Math.min(1, pauses[p].e - pauses[p].s);
  for (let i = 1; i < n - 1; i++) {
    for (let p = i; p < P; p++) {
      for (let q = i - 1; q < p; q++) {
        if (cost[i - 1][q] >= INF) continue;
        const c = cost[i - 1][q] + segCost(pauses[q].e, pauses[p].s, i) - 1.2 * Math.min(1, pauses[p].e - pauses[p].s);
        if (c < cost[i][p]) { cost[i][p] = c; back[i][p] = q; }
      }
    }
  }
  let bestP = -1;
  let best = INF;
  if (n === 1) bestP = -1;
  else {
    for (let p = n - 2; p < P; p++) {
      const c = cost[n - 2][p] + segCost(pauses[p].e, tail, n - 1);
      if (c < best) { best = c; bestP = p; }
    }
    if (bestP < 0) throw new Error('no alignment for ' + file);
  }
  const cuts = [];
  for (let i = n - 2, p = bestP; i >= 0; i--) { cuts.unshift(p); p = back[i][p]; }
  const out = [];
  let from = lead;
  for (let i = 0; i < n; i++) {
    const to = i < n - 1 ? pauses[cuts[i]].s : tail;
    // seconds per unit of weight: a line far off the recording's average pace is a likely mis-cut
    out.push({ start: Math.max(0, from - 0.06), end: Math.min(dur, to + 0.12), pace: (to - from) / w[i] });
    if (i < n - 1) from = pauses[cuts[i]].e;
  }
  const avg = speech / total;
  for (const o of out) o.off = Math.abs(o.pace - avg) / avg;
  return out;
}

if (process.argv[1]?.endsWith('align-audio.mjs') && process.argv[2]) {
  const lines = process.argv.slice(3);
  for (const [i, o] of align(process.argv[2], lines).entries()) console.log(o.start.toFixed(2), o.end.toFixed(2), 'off ' + (o.off * 100).toFixed(0) + '%', lines[i]);
}
