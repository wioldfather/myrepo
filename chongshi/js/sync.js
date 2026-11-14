// Progress sync between devices. Only on the app's claude.ai page, where the platform gives each signed-in
// viewer a private document store; everywhere else this resolves false and the copy-and-paste backup remains.
// Each device merges what it finds with what it has (see store.mergeIn), so work done on either side survives.
import * as store from './store.js';
import { capability } from './llm.js';

const MAX_BYTES = 230000; // a document may hold 256 KiB

export async function startSync(onPulled) {
  const [db, user] = await Promise.all([capability('db'), capability('user')]);
  if (!db || !user) return false;
  let uid = null;
  try { uid = await user.id(); } catch {}
  if (!uid) return false;
  const ref = db.doc('data/users/' + uid + '/progress'); // private to this viewer

  let pushed = '';
  let writing = false;
  let again = false;
  async function pull() {
    try {
      const snap = await ref.get();
      const d = snap.exists ? snap.data() : null;
      if (d && typeof d.json === 'string' && d.json !== pushed && store.mergeIn(JSON.parse(d.json))) onPulled();
    } catch {}
  }
  async function push() {
    if (writing) { again = true; return; } // one write at a time
    const json = store.snapshot();
    if (json === pushed || json.length > MAX_BYTES) return;
    writing = true;
    try { await ref.set({ t: store.stamp(), json }); pushed = json; } catch {}
    writing = false;
    if (again) { again = false; push(); }
  }

  await pull();
  await push();
  let timer;
  store.onSave(() => { clearTimeout(timer); timer = setTimeout(push, 4000); });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') pull().then(push); else push();
  });
  return true;
}
