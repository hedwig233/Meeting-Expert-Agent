import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { transcribeNextOmni } from '../server/next-omni-asr.mjs';

try {
  const fixture = JSON.parse(readFileSync(new URL('../public/demo/meeting.json', import.meta.url), 'utf8')); const wav = readFileSync(new URL('../public/demo/meeting.wav', import.meta.url)); const line = fixture.segments[1];
  const pcm = wav.subarray(44 + Math.floor(line.start * 16000) * 2, 44 + Math.floor(line.end * 16000) * 2);
  console.log('测试 Next 是否透传 qwen3-omni-flash 的音频输入，仅发送原创合成录音，不采集腾讯会议。');
  console.log('参考文字：' + line.text);
  const start = Date.now();
  const result = await transcribeNextOmni({ pcm, apiKey: process.env.NEXT_API_KEY, baseUrl: process.env.NEXT_BASE_URL || 'https://api.openai-next.com/v1', model: process.env.NEXT_ASR_MODEL || 'qwen3-omni-flash', signal: AbortSignal.timeout(60000), hint: '订单，接口，超时，重试，幂等' });
  console.log(JSON.stringify({ model: process.env.NEXT_ASR_MODEL || 'qwen3-omni-flash', seconds: (Date.now() - start) / 1000, text: result.text, accepted: result.accepted }));
  if (!result.accepted) process.exitCode = 1;
} catch (error) { console.error('Qwen 音频验证未完成：' + error.message); process.exitCode = 1; }
