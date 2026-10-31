import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { synthesizeNextOmniSpeech } from '../server/next-omni-speech.mjs';
import { transcribeNextOmni } from '../server/next-omni-asr.mjs';

const text = '这里是会议专家。请先核对接口版本，再确认重试方案。';
const argument = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const voice = argument('voice') || process.env.NEXT_SPEECH_VOICE || 'Cherry';
const style = argument('style') || process.env.NEXT_SPEECH_STYLE || '自然、清晰的中文会议发言语气';
if (!/^[A-Za-z][A-Za-z0-9 -]{0,60}$/.test(voice)) throw new Error('请提供平台音色的 voice 参数值。');
try {
  console.log('验证 Next Qwen 语音输出：只发送固定测试文字，不采集会议、不向腾讯会议发言。');
  const started = Date.now();
  const result = await synthesizeNextOmniSpeech({ text, apiKey: process.env.NEXT_API_KEY, baseUrl: process.env.NEXT_BASE_URL || 'https://api.openai-next.com/v1', model: process.env.NEXT_SPEECH_MODEL || 'qwen3-omni-flash', voice, style });
  const latencySeconds = (Date.now() - started) / 1000;
  let energy = 0, peak = 0;
  for (let i = 44; i < result.audio.length; i += 2) { const value = result.audio.readInt16LE(i) / 32768; energy += value * value; peak = Math.max(peak, Math.abs(value)); }
  const rms = Math.sqrt(energy / ((result.audio.length - 44) / 2));
  if (result.seconds < 0.25 || rms < 0.0001) throw new Error('返回音频过短或只有静音，语音验证未通过。');
  let roundtripText;
  if (process.argv.includes('--roundtrip')) {
    const recognized = await transcribeNextOmni({ pcm: result.audio.subarray(44), apiKey: process.env.NEXT_API_KEY, baseUrl: process.env.NEXT_BASE_URL || 'https://api.openai-next.com/v1', model: process.env.NEXT_ASR_MODEL || 'qwen3-omni-flash', signal: AbortSignal.timeout(60000) });
    roundtripText = recognized.text;
    const normalize = value => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
    if (!recognized.accepted || normalize(roundtripText) !== normalize(text)) throw new Error('返回音频重新转写后与测试文字不一致，语音验证未通过。');
  }
  const directory = new URL('../data/speech-check/', import.meta.url); mkdirSync(directory, { recursive: true });
  const audioPath = new URL('qwen-omni.wav', directory); writeFileSync(audioPath, result.audio);
  const voiceAudioPath = new URL('qwen-omni-' + voice.replaceAll(' ', '-') + '.wav', directory); writeFileSync(voiceAudioPath, result.audio);
  const report = { model: process.env.NEXT_SPEECH_MODEL || 'qwen3-omni-flash', voice: result.voice, style, latencySeconds, audioSeconds: result.seconds, sampleRate: 24000, channels: 1, bitDepth: 16, rms, peak, referenceText: text, transcript: result.transcript, roundtripText, audioPath: fileURLToPath(audioPath), voiceAudioPath: fileURLToPath(voiceAudioPath), verifiedAt: new Date().toISOString() };
  writeFileSync(new URL('result.json', directory), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error('Qwen 语音验证未完成：' + error.message); process.exitCode = 1; }
