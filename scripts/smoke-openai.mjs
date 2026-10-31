import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OpenAiAsr } from '../server/openai-asr.mjs';
import { modelExpert } from '../server/expert.mjs';
import { synthesizeSpeech } from '../server/openai-speech.mjs';
import { resolveModelConfig } from '../server/model-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const transcript = []; let asr;
try {
  if (!process.env.OPENAI_API_KEY) throw new Error('请先在本机 .env 填写 OPENAI_API_KEY。');
  const fixture = JSON.parse(readFileSync(join(root, 'public/demo/meeting.json'), 'utf8'));
  const wav = readFileSync(join(root, 'public/demo/meeting.wav'));
  const line = fixture.segments[1];
  const pcm = wav.subarray(44 + Math.floor(line.start * 16000) * 2, 44 + Math.floor(line.end * 16000) * 2);
  console.log('使用原创合成演示录音验证 OpenAI 转写；不采集屏幕、麦克风或腾讯会议。');
  asr = new OpenAiAsr({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-live-transcribe', onFinal: s => transcript.push(s), onError: () => {} });
  for (let offset = 0; offset < pcm.length; offset += 3200) asr.push(pcm.subarray(offset, Math.min(offset + 3200, pcm.length)), offset / 32000);
  await asr.drain(); asr.close();
  if (!transcript.length) throw new Error('转写服务没有返回演示录音的文字。');
  console.log('ASR 成功：' + transcript.map(s => s.text).join(' '));
  const llm = resolveModelConfig();
  const documents = ['order-api.md', 'incident.md', 'review-guide.md'].map(id => ({ id, title: id, origin: '演示资料', content: readFileSync(join(root, 'knowledge', id), 'utf8') }));
  const result = await modelExpert({ segments: transcript.map(s => ({ ...s, speaker: '演示发言人' })), documents, question: '请评审刚才的方案。', apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model, provider: llm.provider, reasoningEffort: llm.reasoningEffort, signal: AbortSignal.timeout(60000) });
  console.log('专家调用成功；引用数：' + result.citations.length + '；建议：' + result.proposal);
  const speech = await synthesizeSpeech({ text: '这里是人工智能会议专家，语音生成测试完成。', apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_SPEECH_MODEL || 'gpt-realtime-2.1-mini', voice: process.env.OPENAI_SPEECH_VOICE || 'marin' });
  mkdirSync(join(root, 'data'), { recursive: true }); writeFileSync(join(root, 'data', 'bridge-smoke-voice.wav'), speech.audio);
  console.log('语音生成成功；音频已保存在 data/bridge-smoke-voice.wav，未播放或发送至会议。');
} catch (error) { console.error('联调未完成：' + error.message); process.exitCode = 1; }
finally { asr?.close(); }
