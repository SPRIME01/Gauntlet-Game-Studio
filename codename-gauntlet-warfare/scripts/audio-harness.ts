import { CombatAudio } from "../src/audio";

// Browser harness for the audio proof: exposes a CombatAudio wired to an
// AnalyserNode tap so the proof can observe the rendered signal without
// claiming audibility. No gameplay mutation surface.
let audio: CombatAudio;
let context: AudioContext | undefined;
let analyser: AnalyserNode | undefined;

Object.assign(window, {
 audioHarness: {
  create() {
   audio = new CombatAudio(ctx => {
    context = ctx;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.connect(ctx.destination);
    return analyser;
   });
  },
  async unlockProgrammatic() {
   try { await audio.unlock(); } catch (error) { return { threw: String(error) }; }
   return { threw: null };
  },
  contextState() { return audio.state; },
  signal() {
   if (!analyser) return { peak: 0, rms: 0 };
   const data = new Float32Array(analyser.fftSize);
   analyser.getFloatTimeDomainData(data);
   let peak = 0, sum = 0;
   for (const sample of data) { peak = Math.max(peak, Math.abs(sample)); sum += sample * sample; }
   return { peak, rms: Math.sqrt(sum / data.length) };
  },
  playShot(position?: { x: number; y: number; z: number }) { audio.play("shot", position); },
  playReload() { audio.play("reload"); },
  async dispose() { audio.dispose(); },
 },
});
