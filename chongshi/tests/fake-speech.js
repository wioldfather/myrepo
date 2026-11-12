// Fake speech synthesis for headless runs: two Mandarin voices + one English, utterances "finish" after a short delay.
(() => {
  const voices = [
    { name: 'Tingting', lang: 'zh-CN', voiceURI: 'tt', default: false, localService: true },
    { name: 'Google 普通话', lang: 'zh-CN', voiceURI: 'gg', default: false, localService: false },
    { name: 'Samantha', lang: 'en-US', voiceURI: 'sam', default: true, localService: true },
  ];
  window.__spoken = [];
  let timer = null, curU = null;
  const synth = {
    speaking: false, pending: false,
    getVoices: () => voices,
    addEventListener() {},
    cancel() { clearTimeout(timer); this.speaking = false; const u = curU; curU = null; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    speak(u) { if (!u.text.trim()) { u.onend && u.onend({}); return; } window.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice && u.voice.name }); curU = u; this.speaking = true; u.onstart && u.onstart({}); timer = setTimeout(() => { this.speaking = false; curU = null; u.onend && u.onend({}); }, window.__SPEAK_MS || 40); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
})();
