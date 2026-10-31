import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { synthesizeNextOmniSpeech } from '../server/next-omni-speech.mjs';
import { createApplication } from '../server/app.mjs';
import { wavHeader } from '../server/asr.mjs';

const text = '请先核对接口版本，再确认重试方案。';
const pcm = Buffer.from([0, 1, 0, 2, 0, 3, 0, 4]);
const event = delta => ({ choices: [{ delta, finish_reason: null }] });
function response(events, done = true) {
  return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\r\n\r\n').join('') + (done ? 'data: [DONE]\r\n\r\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
}

test('Next speech negotiates the exact Omni model and voice, handles fragmented SSE/Base64, and creates playable WAV', async () => {
  const encoded = pcm.toString('base64');
  const events = [event({ content: text }), event({ audio: { data: encoded.slice(0, 3) } }), event({ audio: { data: encoded.slice(3) } }), { choices: [{ delta: {}, finish_reason: 'stop' }] }];
  const source = await response(events).text(), data = new TextEncoder().encode(source); let offset = 0;
  const stream = new ReadableStream({ pull(controller) { if (offset === data.length) controller.close(); else { const end = Math.min(data.length, offset + 7); controller.enqueue(data.subarray(offset, end)); offset = end; } } });
  const style = '温润沉稳的男声，语速稍慢';
  const result = await synthesizeNextOmniSpeech({ text, apiKey: 'fake-next', voice: 'Ethan', style, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai-next.com/v1/chat/completions'); assert.equal(options.headers.Authorization, 'Bearer fake-next');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen3-omni-flash'); assert.deepEqual(body.audio, { voice: 'Ethan', format: 'wav' });
    assert.deepEqual(body.modalities, ['text', 'audio']); assert.equal(body.stream, true); assert.equal(body.enable_thinking, false);
    assert.equal(body.messages.length, 1); assert(body.messages[0].content.includes(JSON.stringify({ text })));
    assert(body.messages[0].content.includes(style));
    assert.equal(body.tools, undefined); assert.equal(body.messages[0].input_audio, undefined);
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal(result.format, 'audio/wav'); assert.equal(result.transcript, text); assert.equal(result.voice, 'Ethan');
  assert.equal(result.audio.toString('ascii', 0, 4), 'RIFF'); assert.equal(result.audio.readUInt32LE(24), 24000);
  assert.equal(result.audio.readUInt16LE(22), 1); assert.equal(result.audio.readUInt16LE(34), 16); assert.deepEqual(result.audio.subarray(44), pcm);
});

test('audio transcript is checked with punctuation tolerance and independently padded chunks retain every sample', async () => {
  const result = await synthesizeNextOmniSpeech({ text, apiKey: 'test', fetchImpl: async () => response([
    event({ audio: { transcript: '请先核对接口版本，再确认重试方案！', data: pcm.subarray(0, 2).toString('base64') } }),
    event({ audio: { data: pcm.subarray(2).toString('base64') } })
  ]) });
  assert.deepEqual(result.audio.subarray(44), pcm);
});

for (const [name, events, done, pattern] of [
  ['text-only output', [event({ content: text })], true, /PCM16/],
  ['unfinished stream', [event({ content: text, audio: { data: pcm.toString('base64') } })], false, /完成前中断/],
  ['rewritten advice', [event({ content: '直接自动重试三次。', audio: { data: pcm.toString('base64') } })], true, /不一致/],
  ['missing transcript', [event({ audio: { data: pcm.toString('base64') } })], true, /不一致/],
  ['truncated generation', [{ choices: [{ delta: {}, finish_reason: 'length' }] }], true, /未完整生成/],
  ['invalid Base64', [event({ content: text, audio: { data: '!!!' } })], true, /无效的语音编码/],
  ['odd PCM length', [event({ content: text, audio: { data: Buffer.from([1, 2, 3]).toString('base64') } })], true, /PCM16/]
]) test('Next speech rejects ' + name + ' rather than playing it', async () => {
  await assert.rejects(synthesizeNextOmniSpeech({ text, apiKey: 'test', fetchImpl: async () => response(events, done) }), pattern);
});

test('HTTP and in-stream Next speech errors redact authentication credentials', async () => {
  const apiKey = 'sk-test-next-secret';
  for (const fetchImpl of [async () => Response.json({ error: { code: 'unsupported_audio', message: 'Cannot use ' + apiKey } }, { status: 400 }), async () => response([{ error: { code: 'voice_error', message: 'Bearer ' + apiKey } }])]) {
    await assert.rejects(synthesizeNextOmniSpeech({ text, apiKey, fetchImpl }), error => !error.message.includes(apiKey) && /unsupported_audio|voice_error/.test(error.message));
  }
});

test('cancellation and timeout abort the HTTP audio stream and reject late playback', async () => {
  const controller = new AbortController(); let requestSignal;
  const fetchImpl = async (url, options) => {
    requestSignal = options.signal;
    return new Response(new ReadableStream({ start(stream) { options.signal.addEventListener('abort', () => stream.error(options.signal.reason), { once: true }); } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  const pending = synthesizeNextOmniSpeech({ text, apiKey: 'test', signal: controller.signal, fetchImpl });
  controller.abort(); await assert.rejects(pending, /已取消/); assert(requestSignal.aborted);
  const keepAlive = setTimeout(() => {}, 100);
  try { await assert.rejects(synthesizeNextOmniSpeech({ text, apiKey: 'test', timeoutMs: 20, fetchImpl }), /超时/); assert(requestSignal.aborted); }
  finally { clearTimeout(keepAlive); }
});

test('speech API selects Next credentials, keeps Qwen ASR, speaks only existing advice, and supports cancellation', async () => {
  let spoken, releaseStarted; const started = new Promise(resolve => { releaseStarted = resolve; }); let hold = false;
  const app = createApplication({ root: fileURLToPath(new URL('..', import.meta.url)), database: ':memory:', config: { speechProvider: 'next_omni', nextApiKey: 'next-only', nextSpeechModel: 'qwen3-omni-flash', nextSpeechVoice: 'Ethan', nextSpeechStyle: '温润沉稳的男声', asrProvider: 'next_omni', nextAsrModel: 'qwen3-omni-flash', openaiApiKey: 'unused-openai' }, speechSynthesizer: async () => { throw new Error('OpenAI must not be used'); }, nextSpeechSynthesizer: async args => {
    spoken = args; assert.equal(args.apiKey, 'next-only'); assert.equal(args.model, 'qwen3-omni-flash'); assert.equal(args.voice, 'Ethan'); assert.equal(args.style, '温润沉稳的男声');
    if (hold) { releaseStarted(); return new Promise((resolve, reject) => args.signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true })); }
    return { audio: Buffer.concat([wavHeader(pcm.length, 24000), pcm]), format: 'audio/wav' };
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port + '/api';
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const config = await (await fetch(base + '/config')).json();
    assert.equal(config.asr, 'next_omni'); assert.equal(config.speech, true); assert.equal(config.speechProvider, 'next_omni'); assert.equal(config.speechModel, 'qwen3-omni-flash');
    assert(!JSON.stringify(config).includes('next-only')); assert(!JSON.stringify(config).includes('unused-openai'));
    const session = await (await post('/sessions', {})).json(), path = '/sessions/' + session.id;
    assert.equal((await post(path + '/speech', { text: 'unapproved arbitrary text' })).status, 400);
    await post(path + '/segments', { text: '创建订单超时后自动重试三次。' });
    const message = await (await post(path + '/expert', { question: '评审当前方案' })).json();
    const speech = await post(path + '/speech', { messageId: message.id }); assert.equal(speech.status, 200); assert.equal(speech.headers.get('content-type'), 'audio/wav');
    assert.equal(spoken.text, (message.finding + ' ' + message.question + ' ' + message.proposal).slice(0, 1800));
    hold = true; const waiting = post(path + '/speech', { test: true }); await started;
    assert.equal((await post(path + '/cancel', {})).status, 200); assert.equal((await waiting).status, 408); assert(spoken.signal.aborted);
  } finally { await app.close(); }
});

test('missing selected Next credentials never fall back to another configured speech provider', async () => {
  const app = createApplication({ root: fileURLToPath(new URL('..', import.meta.url)), database: ':memory:', config: { speechProvider: 'next_omni', openaiApiKey: 'unused-fallback' }, speechSynthesizer: async () => { throw new Error('must not fall back'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port + '/api';
  try {
    const config = await (await fetch(base + '/config')).json(); assert.equal(config.speech, false);
    const session = await (await fetch(base + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    assert.equal((await fetch(base + '/sessions/' + session.id + '/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"test":true}' })).status, 409);
  } finally { await app.close(); }
});
