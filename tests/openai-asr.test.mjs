import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { OpenAiAsr, Pcm16To24 } from "../server/openai-asr.mjs";

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.emit("open"); }
  receive(event) { this.emit("message", Buffer.from(JSON.stringify(event))); }
  terminate() { this.readyState = 3; this.emit("close"); }
}
function speech(seconds = 0.2) { const buffer = Buffer.alloc(Math.round(seconds * 32000)); for (let i = 0; i < buffer.length; i += 2) buffer.writeInt16LE(i % 4 ? 12000 : -12000, i); return buffer; }
function fixture(options = {}) {
  const socket = new FakeSocket(), partial = [], final = [], errors = [];
  let connection;
  const asr = new OpenAiAsr({ apiKey: "test-only-key", socketFactory: (url, options) => { connection = { url, options }; return socket; }, onPartial: s => partial.push(s), onFinal: s => final.push(s), onError: e => errors.push(e), ...options });
  return { asr, socket, partial, final, errors, connection: () => connection };
}
function ready(socket) { socket.open(); socket.receive({ type: "session.updated" }); }

test("16-to-24kHz resampling is invariant to packet boundaries and preserves duration", () => {
  const raw = speech(0.2);
  const full = new Pcm16To24(); const expected = Buffer.concat([full.convert(raw), full.flush()]);
  const streaming = new Pcm16To24(), chunks = [];
  for (let i = 0; i < raw.length; i += 74) chunks.push(streaming.convert(raw.subarray(i, i + 74)));
  chunks.push(streaming.flush());
  assert.deepEqual(Buffer.concat(chunks), expected); assert.equal(expected.length, 9600);
});

test("audio waits for session configuration, stays PCM24, and maps final text to the committed turn", async () => {
  const f = fixture();
  try {
    f.asr.push(speech(), 3); f.asr.finish();
    assert.equal(f.socket.sent.length, 0);
    assert.equal(f.connection().url, "wss://api.openai.com/v1/realtime?intent=transcription");
    assert.equal(f.connection().options.headers.Authorization, "Bearer test-only-key");
    f.socket.open(); assert.equal(f.socket.sent.length, 1);
    const config = f.socket.sent[0]; assert.equal(config.session.type, "transcription"); assert.equal(config.session.audio.input.format.rate, 24000); assert.equal(config.session.audio.input.turn_detection, null);
    f.socket.receive({ type: "session.updated" });
    assert.equal(f.socket.sent.filter(e => e.type === "input_audio_buffer.commit").length, 1);
    const chunks = f.socket.sent.filter(e => e.type === "input_audio_buffer.append");
    assert.equal(chunks.reduce((n, e) => n + Buffer.from(e.audio, "base64").length, 0), 9600);
    assert(!JSON.stringify(f.socket.sent).includes("test-only-key"));
    f.socket.receive({ type: "input_audio_buffer.committed", item_id: "i1" });
    f.socket.receive({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "你好" });
    assert.equal(f.partial[0].text, "你好"); assert.equal(f.final.length, 0);
    f.socket.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "你好，会议开始。" });
    await f.asr.drain(); assert.equal(f.final[0].start, 3); assert.equal(f.final[0].end, 3.2); assert.equal(f.final[0].text, "你好，会议开始。"); assert.equal(f.errors.length, 0);
  } finally { f.asr.close(); }
});

test("out-of-order final events cannot reorder meeting context; early events wait for item matching", async () => {
  const f = fixture();
  try {
    f.asr.push(speech(), 0); ready(f.socket); f.asr.finish();
    f.asr.push(speech(), 1); f.asr.finish();
    f.socket.receive({ type: "input_audio_buffer.committed", item_id: "first" });
    f.socket.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "second", transcript: "第二句话" });
    f.socket.receive({ type: "input_audio_buffer.committed", item_id: "second" });
    assert.equal(f.final.length, 0);
    f.socket.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "first", transcript: "第一句话" });
    await f.asr.drain(); assert.deepEqual(f.final.map(s => s.text), ["第一句话", "第二句话"]); assert.deepEqual(f.final.map(s => s.start), [0, 1]);
  } finally { f.asr.close(); }
});

test("silence does not create transcription turns, while a speech pause commits the active turn", () => {
  const f = fixture();
  try {
    f.asr.push(Buffer.alloc(6400), 0); ready(f.socket);
    assert.equal(f.socket.sent.filter(e => e.type === "input_audio_buffer.append").length, 0);
    f.asr.push(speech(), 0.2);
    for (let i = 0; i < 4; i++) f.asr.push(Buffer.alloc(6400), 0.4 + i * 0.2);
    assert.equal(f.socket.sent.filter(e => e.type === "input_audio_buffer.commit").length, 1);
  } finally { f.asr.close(); }
});

test("failed and missing final transcripts reject synchronization rather than pretending completion", async () => {
  const f = fixture({ timeoutMs: 20 });
  try {
    f.asr.push(speech(), 0); ready(f.socket); f.asr.finish();
    await assert.rejects(() => f.asr.drain(), /最终转写超时/); assert.equal(f.errors.length, 1); assert.equal(f.final.length, 0);
  } finally { f.asr.close(); }
  const failed = fixture();
  try {
    failed.asr.push(speech(), 0); ready(failed.socket); failed.asr.finish();
    failed.socket.receive({ type: "conversation.item.input_audio_transcription.failed", item_id: "i1" });
    await assert.rejects(() => failed.asr.drain(), /识别失败/); assert.equal(failed.errors.length, 1);
  } finally { failed.asr.close(); }
});
