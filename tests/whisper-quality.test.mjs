import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhisperQuality, LocalWhisperAsr } from '../server/local-whisper.mjs';
import { containsWakeCommand } from '../src/wake-word.mjs';

test('low-probability text is rejected while valid text remains a model candidate', () => {
  assert.equal(parseWhisperQuality({ transcription: [{ text: '全體意法也', tokens: [{ text: '全', p: 0.1 }, { text: '體', p: 0.2 }] }] }).accepted, false);
  assert.equal(parseWhisperQuality({ transcription: [{ text: '请太医发言', tokens: [{ text: '请', p: 0.9 }, { text: '太医', p: 0.8 }] }] }).accepted, true);
});
test('low-confidence transcription does not enter the expert context', async () => {
  const final = [], notices = []; const audio = Buffer.alloc(16000); for (let i = 0; i < audio.length; i += 2) audio.writeInt16LE(6000, i);
  const asr = new LocalWhisperAsr({ transcribe: async () => ({ text: 'unreliable', accepted: false, confidence: 0.1 }), onFinal: s => final.push(s), onUncertain: s => notices.push(s) });
  asr.push(audio); await asr.drain(); assert.equal(final.length, 0); assert.equal(notices.length, 1); asr.close();
});
test('brief clicks are discarded without sending noise to Whisper', async () => {
  let called = false; const asr = new LocalWhisperAsr({ transcribe: async () => { called = true; return 'invented'; } });
  const click = Buffer.alloc(1600); for (let i = 0; i < click.length; i += 2) click.writeInt16LE(5000, i);
  asr.push(click); await asr.drain(); assert.equal(called, false); asr.close();
});
test('wake commands accept traditional variants without treating unrelated gibberish as a command', () => {
  assert(containsWakeCommand('請太醫發言。', '请太医发言'));
  assert(containsWakeCommand('好的，请专家发言！', '请专家发言'));
  assert.equal(containsWakeCommand('全體意法也', '请太医发言'), false);
  assert.equal(containsWakeCommand('继续讨论', ''), false);
});
