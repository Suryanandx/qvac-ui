// Generates fixtures/team-meeting.wav: a synthetic two-voice meeting made with the
// local Supertonic TTS (voices F1 and M1), for testing speaker labels. No real people.
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resample, encodeWav16 } from '../server/studio.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.QVAC_CONFIG_PATH ||= join(root, '.local', 'qvac.config.json');
const sdk = await import('@qvac/sdk');
const lines = [
  ['F1', 'Good morning everyone. Let us review the launch plan for the mobile app.'],
  ['M1', 'Thanks. The beta build is ready, but we still need the privacy review before release.'],
  ['F1', 'Okay. I will book the privacy review with legal by Wednesday.'],
  ['M1', 'Great. I will fix the login crash and ship a new beta on Thursday.'],
  ['F1', 'We decided to delay the public launch to November tenth. Any open questions?'],
  ['M1', 'Yes. Who is writing the release notes? We have not assigned that yet.']
];
// Supertonic fixes the voice at load time, so load one instance per voice.
const voices = {};
for (const voice of ['F1', 'M1']) voices[voice] = await sdk.loadModel({ modelSrc: join(root, 'models/supertonic-q4_0.gguf'), modelType: 'tts-ggml', modelConfig: { ttsEngine: 'supertonic', voice, language: 'en', ttsNumInferenceSteps: 8, seed: 7 }, modelFitPolicy: 'off' });
const parts = [];
for (const [voice, text] of lines) {
  const call = sdk.textToSpeech({ modelId: voices[voice], text, inputType: 'text', stream: false });
  const [samples, rate] = await Promise.all([call.buffer, call.sampleRate]);
  parts.push(resample(Float32Array.from(samples, v => v / 32768), rate, 16000), new Float32Array(16000 * 0.6));
}
for (const id of Object.values(voices)) await sdk.unloadModel({ modelId: id }); await sdk.close();
const total = parts.reduce((n, p) => n + p.length, 0), all = new Float32Array(total); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
await writeFile(join(root, 'fixtures/team-meeting.wav'), encodeWav16(all));
console.log('wrote fixtures/team-meeting.wav', (total / 16000).toFixed(1), 's'); process.exit(0);
