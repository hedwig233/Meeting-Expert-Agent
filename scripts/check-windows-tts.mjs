import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { localSpeech } from '../server/local-speech.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  console.log('检查 Windows 中文音色，只生成固定短句，不向腾讯会议播放。');
  const result = await localSpeech({ text: '这里是人工智能会议专家，中文语音测试完成。', root, voice: process.env.WINDOWS_SPEECH_VOICE });
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true }); writeFileSync(new URL('../data/windows-tts-check.wav', import.meta.url), result.audio);
  console.log('成功；实际音色：' + (result.voice || 'Windows Chinese') + '；音频字节数：' + result.audio.length + '；文件：data/windows-tts-check.wav');
} catch (error) { console.error(error.message); process.exitCode = 1; }
