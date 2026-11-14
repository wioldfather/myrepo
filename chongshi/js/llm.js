// Talking to Claude. Two ways in, tried in this order:
//   1. Inside its claude.ai artifact page the app asks Claude through the page's `sample` capability, on the
//      viewer's own Claude plan. Nothing to set up.
//   2. Anywhere else (the installed app, GitHub Pages) it calls the Claude API directly with a key the learner
//      pastes into Settings. The key stays in this browser and is sent only to api.anthropic.com.
const KEY = 'chongshi.key';
const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';

export const apiKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export function setApiKey(k) {
  try { if (k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch {}
}

// claude.use() resolves null wherever the capability cannot run; outside a Claude page there is no window.claude.
const cap = {};
export function capability(name) {
  if (!(name in cap)) cap[name] = window.claude && window.claude.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
  return cap[name];
}

// 'claude' (artifact page) · 'key' (own API key) · null (conversation unavailable until one is set up)
export async function backend() {
  if (await capability('sample')) return 'claude';
  return apiKey() ? 'key' : null;
}

const fail = (code, message) => Object.assign(new Error(message), { code });
// Codes the UI words for the learner. Everything unrecognised is 'failed'.
const SAMPLE_CODES = { not_granted: 'denied', sampling_disabled: 'denied', not_declared: 'denied', capability_disabled: 'denied', rate_limited: 'busy', session_expired: 'signin', refused: 'refused', cancelled: 'cancelled' };

/** Ask Claude. `system` holds the standing instructions; `turns` is the conversation so far, starting with
 *  Claude's own first line (or empty to have Claude open). Resolves with the reply text. */
export async function ask({ system, turns = [], quick = false, onText, signal }) {
  const sample = await capability('sample');
  if (sample) {
    // No system role here: the instructions ride in a leading user turn, and the list must end on a user turn.
    const input = turns.length ? [{ role: 'user', content: system }, ...turns] : system + '\n\nBegin now.';
    try {
      const res = await sample(input, { cache: false, modelTier: quick ? 'quick' : 'default', signal, onText: onText ? ({ text }) => onText(text) : undefined });
      return res.text;
    } catch (e) {
      throw fail(SAMPLE_CODES[e && e.code] || 'failed', (e && e.message) || 'Claude did not answer');
    }
  }
  if (!apiKey()) throw fail('setup', 'No connection to Claude is set up');
  return viaApi({ system, turns, quick, onText, signal });
}

async function viaApi({ system, turns, quick, onText, signal }) {
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey(),
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        stream: true,
        system,
        // The API needs a user turn first; the conversation proper starts with Claude's opening line.
        messages: [{ role: 'user', content: '（开始）' }, ...turns],
        output_config: { effort: quick ? 'low' : 'medium' },
        fallbacks: 'default', // if a safety classifier declines, the API retries on a fallback model
      }),
    });
  } catch (e) {
    throw fail(e.name === 'AbortError' ? 'cancelled' : 'offline', e.message);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error.message || msg; } catch {}
    throw fail(res.status === 401 || res.status === 403 ? 'key' : res.status === 429 || res.status === 529 ? 'busy' : 'failed', msg);
  }
  // Server-sent events: collect the text deltas, watch for the stop reason.
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let stop = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          text += ev.delta.text;
          if (onText) onText(text);
        } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === 'error') throw fail(ev.error && ev.error.type === 'overloaded_error' ? 'busy' : 'failed', (ev.error && ev.error.message) || 'stream error');
      }
    }
  } catch (e) {
    if (e.code) throw e;
    throw fail(e.name === 'AbortError' ? 'cancelled' : 'offline', e.message);
  }
  if (stop === 'refusal') throw fail('refused', 'Claude declined this request');
  if (!text.trim()) throw fail('failed', 'Claude returned no text');
  return text;
}

/** Ask for one JSON object. Tolerant of a code fence or a sentence around it. */
export async function askJson(prompt, signal) {
  const text = await ask({ system: prompt, signal });
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  try { return JSON.parse(text.slice(a, b + 1)); } catch { throw fail('failed', 'Claude replied in an unexpected format'); }
}

export const MESSAGES = {
  setup: 'Conversation needs a connection to Claude. Set one up below.',
  denied: 'Claude is not available to this page. Allow it in the page’s Permissions menu, or use an API key.',
  key: 'That API key was rejected. Check it in Settings.',
  busy: 'Claude is busy or you have reached a usage limit. Try again in a moment.',
  signin: 'Your Claude session expired. Sign in again, then retry.',
  offline: 'No connection. Live conversation needs to be online.',
  refused: 'Claude declined to answer that. Try saying it another way.',
  failed: 'Something went wrong reaching Claude. Try again.',
};
