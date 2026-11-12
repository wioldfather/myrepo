// The guided "seated ride": the next scene, then a puzzle mix, then Recall.
// Input first, varied practice second, production from memory last, a few minutes after first meeting each phrase.
import * as store from './store.js';
import { go, button } from './ui.js';

let journey = null;

export function startJourney() {
  const sc = store.nextScene();
  journey = { i: 0, legs: [{ hash: 'scene-' + sc.id, label: sc.zh }, { hash: 'game-mix', label: 'Puzzle mix' }, { hash: 'recall', label: 'Recall' }] };
  go(journey.legs[0].hash);
}
// Called on every navigation: wandering off the current leg ends the ride.
export function journeyAt(hash) {
  if (journey && journey.legs[journey.i].hash !== hash) journey = null;
  return journey ? `Leg ${journey.i + 1}/${journey.legs.length}` : '';
}
// Buttons for the end of any activity: carry on with the ride if one is running, otherwise head home.
export function wayOut(againLabel, again) {
  const out = [];
  if (journey && journey.i < journey.legs.length - 1) {
    const nx = journey.legs[journey.i + 1];
    out.push(button('Next leg: ' + nx.label, 'primary', () => { journey.i++; go(nx.hash); }, 'arrow'));
  } else {
    const wasRide = !!journey;
    journey = null;
    out.push(button(wasRide ? 'Ride complete' : 'Back to today', 'primary', () => go('home'), wasRide ? 'check' : null));
  }
  if (again) out.push(button(againLabel, 'ghost', again, 'again'));
  return out;
}
