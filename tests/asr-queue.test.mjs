import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWhisperAsr } from '../server/local-whisper.mjs';

const audio = Buffer.alloc(16000);
for (let i = 0; i < audio.length; i += 2) audio.writeInt16LE(6000, i);
const tick = () => new Promise(resolve => setImmediate(resolve));
const turn = (asr, offset = 0) => asr.push(audio, offset);

test('slow cloud transcription pauses a bounded queue and resumes in order', async () => {
  const releases = [], states = [], final = [], errors = [];
  const asr = new LocalWhisperAsr({
    backpressure: true, recoverSegmentErrors: true, maxTurnSeconds: 0.5,
    transcribe: () => new Promise(resolve => releases.push(resolve)),
    onState: state => states.push(state), onFinal: segment => final.push(segment), onError: error => errors.push(error)
  });
  try {
    for (let i = 0; i < 4; i++) turn(asr, i);
    assert.equal(asr.pending.length, 3); assert.equal(asr.paused, true);
    assert.doesNotThrow(() => turn(asr, 4));
    assert.equal(asr.pending.length, 3); assert.equal(asr.active, null);
    releases.shift()('first'); await tick();
    assert.equal(asr.paused, true);
    releases.shift()('second'); await tick();
    assert.equal(asr.paused, false);
    turn(asr, 5); // Input resumes without a new ASR session.
    for (const text of ['third', 'fourth', 'resumed']) { releases.shift()(text); await tick(); }
    await asr.drain();
    assert.deepEqual(final.map(s => s.text), ['first', 'second', 'third', 'fourth', 'resumed']);
    assert.deepEqual(final.map(s => s.start), [0, 1, 2, 3, 5]);
    assert.equal(errors.length, 0);
    assert(states.some(s => s.paused && s.pending === 3));
    assert.deepEqual(states.at(-1), { pending: 0, processing: false, paused: false });
  } finally { asr.close(); }
});

test('uncertain and failed cloud segments do not poison later transcription', async () => {
  let call = 0; const notices = [], final = [], errors = [];
  const asr = new LocalWhisperAsr({
    backpressure: true, recoverSegmentErrors: true, maxTurnSeconds: 0.5,
    transcribe: async () => {
      if (++call === 1) return { text: '[听不清]', accepted: false };
      if (call === 2) throw new Error('fetch failed');
      return { text: '请太医发言', accepted: true };
    },
    onUncertain: () => notices.push('uncertain'), onSegmentError: error => notices.push(error.message),
    onFinal: s => final.push(s.text), onError: error => errors.push(error)
  });
  try {
    for (let i = 0; i < 3; i++) turn(asr, i);
    await asr.drain();
    assert.deepEqual(notices, ['uncertain', 'fetch failed']);
    assert.deepEqual(final, ['请太医发言']); assert.equal(errors.length, 0);
    assert.equal(asr.error, null); assert.doesNotThrow(() => turn(asr, 3));
    await asr.drain();
    assert.equal(final.length, 2);
  } finally { asr.close(); }
});

test('timeout releases a stuck cloud request and drains the following segment', async () => {
  let call = 0; const final = [], notices = [];
  const asr = new LocalWhisperAsr({
    recoverSegmentErrors: true, label: 'Qwen 云端转写', maxTurnSeconds: 0.5, timeoutMs: 30,
    transcribe: () => ++call === 1 ? new Promise(() => {}) : Promise.resolve('后续片段'),
    onSegmentError: e => notices.push(e.message), onFinal: s => final.push(s.text)
  });
  try {
    turn(asr); turn(asr, 1); await asr.drain();
    assert.match(notices[0], /Qwen 云端转写.*超时/);
    assert.deepEqual(final, ['后续片段']); assert.equal(asr.error, null);
  } finally { asr.close(); }
});

test('closing a paused cloud session cancels work without resuming or reporting failure', async () => {
  const states = [], notices = [], final = [];
  const asr = new LocalWhisperAsr({
    backpressure: true, recoverSegmentErrors: true, maxTurnSeconds: 0.5,
    transcribe: () => new Promise(() => {}), onState: s => states.push(s),
    onSegmentError: e => notices.push(e), onFinal: s => final.push(s)
  });
  for (let i = 0; i < 4; i++) turn(asr, i);
  assert.equal(asr.paused, true);
  const count = states.length; asr.close(); await tick();
  assert.equal(asr.running, false); assert.equal(asr.controllers.size, 0);
  assert.equal(asr.pending.length, 0); assert.equal(states.length, count);
  assert.deepEqual(notices, []); assert.deepEqual(final, []);
});
