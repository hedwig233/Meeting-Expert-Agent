import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';

const path = new URL('../.env', import.meta.url);
let text = readFileSync(path, 'utf8');
const before = parse(text);
const voice = process.argv.find(value => value.startsWith('--voice='))?.slice(8) || before.NEXT_SPEECH_VOICE || 'Cherry';
if (!before.NEXT_API_KEY?.trim()) throw new Error('请先在 .env 中填写 NEXT_API_KEY。');
const verification = JSON.parse(readFileSync(new URL('../data/speech-check/result.json', import.meta.url), 'utf8'));
if (verification.model !== 'qwen3-omni-flash' || verification.voice !== voice || verification.audioSeconds < 0.25 || verification.rms < 0.0001 || verification.referenceText !== verification.transcript) throw new Error('请先运行 npm.cmd run qwen:tts:check，验证目标模型和音色。');
const updates = { SPEECH_PROVIDER: 'next_omni', NEXT_SPEECH_MODEL: 'qwen3-omni-flash', NEXT_SPEECH_VOICE: voice, NEXT_SPEECH_STYLE: verification.style || '自然、清晰的中文会议发言语气' };
for (const [key, value] of Object.entries(updates)) {
  const entry = key + '=' + value, pattern = new RegExp('^' + key + '=.*$', 'm');
  text = pattern.test(text) ? text.replace(pattern, () => entry) : text.trimEnd() + '\n' + entry + '\n';
}
const after = parse(text);
for (const [key, value] of Object.entries(updates)) if (after[key] !== value) throw new Error('语音配置未正确更新，未写入 .env。');
for (const [key, value] of Object.entries(before)) if (!(key in updates) && after[key] !== value) throw new Error('检测到语音配置之外的变化，未写入 .env。');
writeFileSync(path, text, { mode: 0o600 });
console.log('专家语音已切换到 Next qwen3-omni-flash / ' + voice + '；原转写、分析配置及凭证已保留。请重启后端。');
