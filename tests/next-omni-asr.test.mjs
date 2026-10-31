import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeNextOmni } from '../server/next-omni-asr.mjs';

test('Omni receives real WAV audio and text-only streaming instructions using the exact requested ID', async () => {
  const events = ['data: ' + JSON.stringify({ choices: [{ delta: { content: '请太医' }, finish_reason: null }] }) + '\n\n', 'data: ' + JSON.stringify({ choices: [{ delta: { content: '发言' }, finish_reason: 'stop' }] }) + '\n\n', 'data: [DONE]\n\n'];
  const encoded = new TextEncoder().encode(events.join('')); let position = 0;
  const stream = new ReadableStream({ pull(controller) { if (position >= encoded.length) controller.close(); else { controller.enqueue(encoded.slice(position, position += 7)); } } });
  const partial = [];
  const result = await transcribeNextOmni({ pcm: Buffer.alloc(3200), apiKey: 'test', model: 'qwen3-omni-flash', onPartial: s => partial.push(s), fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai-next.com/v1/chat/completions'); const body = JSON.parse(options.body); assert.equal(body.model, 'qwen3-omni-flash'); assert.deepEqual(body.modalities, ['text']); assert.equal(body.stream, true);
    const input = body.messages[0].content[0]; assert.equal(input.type, 'input_audio'); assert.equal(input.input_audio.format, 'wav'); assert(input.input_audio.data.startsWith('data:audio/wav;base64,'));
    const wav = Buffer.from(input.input_audio.data.split(',')[1], 'base64'); assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), 16000);
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal(result.text, '请太医发言'); assert(result.accepted); assert.deepEqual(partial, ['请太医', '请太医发言']);
});
test('incomplete streaming transcription is rejected rather than entering expert context', async () => {
  await assert.rejects(() => transcribeNextOmni({ pcm: Buffer.alloc(3200), apiKey: 'test', fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n', { headers: { 'content-type': 'text/event-stream' } }) }), /完成前中断/);
});
test('gateway errors keep the useful model error and redact credentials', async () => {
  const key = 'sk-secret';
  await assert.rejects(() => transcribeNextOmni({ pcm: Buffer.alloc(3200), apiKey: key, fetchImpl: async () => Response.json({ error: { code: 'model_not_found', message: 'no audio support ' + key } }, { status: 400 }) }), e => e.message.includes('model_not_found') && !e.message.includes(key));
});
