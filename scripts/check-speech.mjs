import 'dotenv/config';
import { synthesizeSpeech } from '../server/openai-speech.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const directory = new URL('../data/', import.meta.url);
try {
  console.log('验证 OpenAI 语音生成；仅生成固定测试短句，不向腾讯会议播放。');
  const result = await synthesizeSpeech({ text: '这是人工智能语音测试。', apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_SPEECH_MODEL || 'gpt-realtime-2.1-mini', voice: process.env.OPENAI_SPEECH_VOICE || 'marin', timeoutMs: 20000 });
  mkdirSync(directory, { recursive: true }); writeFileSync(new URL('speech-check.wav', directory), result.audio);
  console.log('测试成功，音频已保存到 data/speech-check.wav。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
