import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { synthesizeSpeech } from "../server/openai-speech.mjs";
import { describeOpenAiError } from "../server/openai-error.mjs";

class FakeSocket extends EventEmitter {
  sent = []; terminated = false;
  send(data) { this.sent.push(JSON.parse(data)); }
  terminate() { this.terminated = true; }
}
test("Realtime voice reads approved text and wraps returned PCM as playable 24kHz WAV", async () => {
  const socket = new FakeSocket(); let seenUrl;
  const result = synthesizeSpeech({ text: "先检查水样来源。", apiKey: "test", socketFactory: (url, options) => { seenUrl = url; assert.equal(options.headers.Authorization, "Bearer test"); return socket; } });
  socket.emit("open"); assert.equal(socket.sent[0].session.audio.output.format.rate, 24000); assert.equal(socket.sent[0].session.model, undefined);
  assert(seenUrl.includes("gpt-realtime-2.1-mini"));
  socket.emit("message", Buffer.from(JSON.stringify({ type: "session.updated" })));
  const user = socket.sent.find(e => e.type === "conversation.item.create"); assert.equal(JSON.parse(user.item.content[0].text).text, "先检查水样来源。");
  assert.deepEqual(socket.sent.at(-1).response.output_modalities, ["audio"]);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.from([0, 1, 0, 2]).toString("base64") })));
  socket.emit("message", Buffer.from(JSON.stringify({ type: "response.done", response: { status: "completed" } })));
  const output = await result; assert.equal(output.format, "audio/wav"); assert.equal(output.audio.readUInt32LE(24), 24000); assert.equal(output.audio.length, 48); assert(socket.terminated);
});
test("voice cancellation closes the provider connection", async () => {
  const socket = new FakeSocket(); const controller = new AbortController();
  const result = synthesizeSpeech({ text: "test", apiKey: "test", signal: controller.signal, socketFactory: () => socket });
  controller.abort(); await assert.rejects(result, /已取消/); assert(socket.terminated);
});
test("empty or failed provider audio is not presented as a successful voice response", async () => {
  const socket = new FakeSocket();
  const result = synthesizeSpeech({ text: "test", apiKey: "test", socketFactory: () => socket });
  socket.emit("message", Buffer.from(JSON.stringify({ type: "response.done", response: { status: "failed" } })));
  await assert.rejects(result, /未生成完成/);
});
test('provider failure reports the field and code while redacting authentication secrets', async () => {
  const secret = 'sk-test-secret'; const socket = new FakeSocket();
  const result = synthesizeSpeech({ text: 'test', apiKey: secret, socketFactory: () => socket });
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'error', error: { code: 'unknown_parameter', param: 'session.model', message: 'Unknown parameter session.model. key=' + secret } })));
  await assert.rejects(result, error => error.message.includes('session.model') && error.message.includes('unknown_parameter') && !error.message.includes(secret));
  assert(!describeOpenAiError({ message: 'Incorrect key sk-proj-abc***xyz' }, secret).includes('sk-proj-abc'));
});
