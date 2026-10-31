import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
const path = new URL('../.env', import.meta.url); let text = readFileSync(path, 'utf8'); const env = parse(text);
const set = (key, value) => { const entry = key + '=' + value; const pattern = new RegExp('^' + key + '=.*$', 'm'); text = pattern.test(text) ? text.replace(pattern, () => entry) : text.trimEnd() + '\n' + entry + '\n'; };
if (!env.NEXT_API_KEY?.trim() && env.OPENAI_API_KEY?.trim()) { set('NEXT_API_KEY', env.OPENAI_API_KEY.trim()); set('OPENAI_API_KEY', ''); }
set('LLM_PROVIDER', 'openai_next'); set('NEXT_BASE_URL', 'https://api.openai-next.com/v1'); set('NEXT_MODEL', 'gpt-5.6-terra'); set('NEXT_REASONING_EFFORT', 'none');
set('ASR_PROVIDER', 'local'); set('SPEECH_PROVIDER', 'windows');
writeFileSync(path, text, { mode: 0o600 }); console.log('已配置 Next 专家 + 本地 Whisper + Windows 中文语音。Key 已保留为 NEXT_API_KEY，未打印或发送。');
