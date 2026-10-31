import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { whisperConfig, transcribeLocal } from '../server/local-whisper.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  const config = whisperConfig(root); if (!config.ready) throw new Error('请先安装本地 Whisper。');
  const fixture = JSON.parse(readFileSync(new URL('../public/demo/meeting.json', import.meta.url), 'utf8')); const wav = readFileSync(new URL('../public/demo/meeting.wav', import.meta.url)); const line = fixture.segments[1];
  const pcm = wav.subarray(44 + Math.floor(line.start * 16000) * 2, 44 + Math.floor(line.end * 16000) * 2);
  console.log('使用原创合成录音检查本地解码；不采集真实会议，也不调用 LLM。参考文字：' + line.text);
  const start = Date.now();
  const result = await transcribeLocal({ root, ...config, pcm, withQuality: true, prompt: '以下是简体中文会议记录。术语：接口，订单，超时，重试，幂等。' });
  console.log(JSON.stringify({ model: config.modelName, vad: Boolean(config.vadModel), seconds: (Date.now() - start) / 1000, text: result.text, confidence: result.confidence, accepted: result.accepted }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
