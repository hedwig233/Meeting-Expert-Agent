import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalWhisperAsr, whisperConfig } from '../server/local-whisper.mjs';
import { resolveModelConfig } from '../server/model-config.mjs';
import { modelExpert } from '../server/expert.mjs';

function frame(value = 4000, samples = 1600) { const b = Buffer.alloc(samples * 2); for (let i = 0; i < samples; i++) b.writeInt16LE(value, i * 2); return b; }
test('Next key is scoped to its issuing platform and uses the exact selected model ID', () => {
  const c = resolveModelConfig({ LLM_PROVIDER: 'openai_next', NEXT_API_KEY: 'next-test', NEXT_MODEL: 'gpt-5.6-terra', OPENAI_API_KEY: 'unused' });
  assert.equal(c.baseUrl, 'https://api.openai-next.com/v1'); assert.equal(c.apiKey, 'next-test'); assert.equal(c.model, 'gpt-5.6-terra');
  assert.equal(resolveModelConfig({ LLM_PROVIDER: 'openai_next', OPENAI_API_KEY: 'unused' }).apiKey, undefined);
});
test('local speech turns publish in order while silences never become invented transcripts', async () => {
  const finals = []; let index = 0;
  const asr = new LocalWhisperAsr({ maxTurnSeconds: 0.2, minVoicedSeconds: 0.1, transcribe: async pcm => { assert(pcm.length > 0); const n = ++index; await new Promise(r => setTimeout(r, 5)); return '真实音频段 ' + n; }, onFinal: s => finals.push(s) });
  asr.push(frame(), 0.1); asr.push(frame(), 0.2); asr.push(frame(), 0.3); asr.push(frame(), 0.4);
  await asr.drain(); assert.deepEqual(finals.map(s => s.text), ['真实音频段 1', '真实音频段 2']); assert(finals[0].start <= finals[1].start); asr.close();
  const silent = new LocalWhisperAsr({ transcribe: async () => { throw new Error('silence must not be sent to recognition'); } }); silent.push(frame(0)); await silent.drain(); silent.close();
});
test('local recognizer errors reject synchronization and cancellation suppresses late output', async () => {
  const failed = new LocalWhisperAsr({ minVoicedSeconds: 0.1, transcribe: async () => { throw new Error('recognizer failed'); } }); failed.push(frame());
  await assert.rejects(failed.drain(), /recognizer failed/); failed.close();
  let publish = false; let resolve;
  const pending = new LocalWhisperAsr({ minVoicedSeconds: 0.1, transcribe: () => new Promise(r => { resolve = r; }), onFinal: () => { publish = true; } }); pending.push(frame()); pending.finish(); pending.close(); resolve('late text'); await new Promise(r => setTimeout(r, 5)); assert.equal(publish, false);
});
test('a missing local model is not advertised as installed', () => {
  assert.equal(whisperConfig('C:/nonexistent-seat-test-root', {}).ready, false);
});
test('Next compatibility adapter performs documented chat-completion tool exchange', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai-next.com/v1/chat/completions'); const body = JSON.parse(options.body); assert.equal(body.model, 'gpt-5.6-terra');
    if (calls === 1) return Response.json({ choices: [{ message: { tool_calls: [{ id: 't1', function: { name: 'search_company_docs', arguments: JSON.stringify({ query: '证据记录' }) }, type: 'function' }] } }] });
    const source = JSON.parse(body.messages.find(m => m.role === 'tool').content)[0];
    return Response.json({ choices: [{ message: { content: JSON.stringify({ contextSummary: '核查证据', finding: '条件不明', impact: '不足以下结论', question: '记录在哪里', proposal: '补充记录', confidence: '待确认', citationIds: [source.id] }) } }] });
  };
  try { const result = await modelExpert({ provider: 'openai_next', apiKey: 'test', baseUrl: 'https://api.openai-next.com/v1', model: 'gpt-5.6-terra', question: '评审', segments: [], documents: [{ id: 'd1', title: '证据记录', origin: 'test', content: '检查证据记录。' }] }); assert.equal(result.provider, 'openai_next'); assert.equal(result.citations.length, 1); }
  finally { globalThis.fetch = original; }
});
