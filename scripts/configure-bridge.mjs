import { readFileSync, writeFileSync, existsSync } from "node:fs";
const path = new URL("../.env", import.meta.url);
let text = existsSync(path) ? readFileSync(path, "utf8") : "";
const defaults = { LLM_PROVIDER: "openai", ASR_PROVIDER: "openai", OPENAI_TRANSCRIPTION_MODEL: "gpt-live-transcribe", OPENAI_SPEECH_MODEL: "gpt-realtime-2.1-mini", OPENAI_SPEECH_VOICE: "marin" };
for (const [key, value] of Object.entries(defaults)) if (!new RegExp("^" + key + "=", "m").test(text)) text += "\n" + key + "=" + value;
writeFileSync(path, text, { mode: 0o600 });
console.log("已补齐桌面桥接默认配置；保留已有模型、API Key 和语音设置，未打印密钥。");
