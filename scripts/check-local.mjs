import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localSpeech } from '../server/local-speech.mjs';
import { whisperConfig, transcribeLocal } from '../server/local-whisper.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  const speech = await localSpeech({ root, text: '这是本地中文语音测试。', voice: process.env.WINDOWS_SPEECH_VOICE });
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true }); writeFileSync(new URL('../data/local-speech-check.wav', import.meta.url), speech.audio);
  console.log('本地中文语音生成成功，未播放到腾讯会议。');
  const config = whisperConfig(root); if (!config.ready) throw new Error('本地 Whisper 尚未安装，请先运行 npm.cmd run whisper:setup。');
  const fixture = JSON.parse(readFileSync(new URL('../public/demo/meeting.json', import.meta.url), 'utf8')); const wav = readFileSync(new URL('../public/demo/meeting.wav', import.meta.url)); const line = fixture.segments[1];
  const pcm = wav.subarray(44 + Math.floor(line.start * 16000) * 2, 44 + Math.floor(line.end * 16000) * 2);
  const text = await transcribeLocal({ root, ...config, pcm }); console.log('本地转写结果：' + text);
} catch (error) { console.error(error.message); process.exitCode = 1; }
