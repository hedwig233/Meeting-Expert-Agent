import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApplication } from "./app.mjs";
import { loadDeviceProfile } from "./dui-auth.mjs";
import { resolveModelConfig } from "./model-config.mjs";
import { whisperConfig } from './local-whisper.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const asrProvider = process.env.ASR_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "dui");
if (!["openai", "dui", "local", "next_omni"].includes(asrProvider)) throw new Error("ASR_PROVIDER 必须为 openai、dui、local 或 next_omni。");
const deviceProfile = asrProvider === "dui" ? loadDeviceProfile(root, process.env.DUI_PRODUCT_ID) : null;
const llm = resolveModelConfig();
const speechProvider = process.env.SPEECH_PROVIDER || (llm.provider === 'openai_next' ? 'next_omni' : 'openai');
if (!['next_omni', 'windows', 'openai'].includes(speechProvider)) throw new Error('SPEECH_PROVIDER 必须为 next_omni、windows 或 openai。');
const config = { qwenApiKey: llm.apiKey, qwenBaseUrl: llm.baseUrl, qwenModel: llm.model, llmProvider: llm.provider, reasoningEffort: llm.reasoningEffort, asrProvider, openaiApiKey: process.env.OPENAI_API_KEY, openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-live-transcribe", openaiSpeechModel: process.env.OPENAI_SPEECH_MODEL || "gpt-realtime-2.1-mini", openaiSpeechVoice: process.env.OPENAI_SPEECH_VOICE || "marin", duiProductId: process.env.DUI_PRODUCT_ID, duiApiKey: process.env.DUI_API_KEY, duiDeviceName: deviceProfile?.deviceName, duiDeviceSecret: deviceProfile?.deviceSecret, duiBranch: process.env.DUI_BRANCH || "prod" };
Object.assign(config, { localWhisper: whisperConfig(root), speechProvider, windowsSpeechVoice: process.env.WINDOWS_SPEECH_VOICE });
Object.assign(config, { nextApiKey: process.env.NEXT_API_KEY, nextBaseUrl: process.env.NEXT_BASE_URL || 'https://api.openai-next.com/v1', nextAsrModel: process.env.NEXT_ASR_MODEL || 'qwen3-omni-flash', nextSpeechModel: process.env.NEXT_SPEECH_MODEL || 'qwen3-omni-flash', nextSpeechVoice: process.env.NEXT_SPEECH_VOICE || 'Cherry', nextSpeechStyle: process.env.NEXT_SPEECH_STYLE || '自然、清晰的中文会议发言语气' });
const application = createApplication({ root, config });
const { app, server } = application;
let vite;
if (process.argv.includes("--production")) {
  app.use(express.static(join(root, "dist")));
  app.get("/{*path}", (req, res) => res.sendFile(join(root, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { server, path: "/vite-hmr" } }, appType: "spa" });
  app.use(vite.middlewares);
}
const host = process.env.HOST || "127.0.0.1"; const port = Number(process.env.PORT || 4317);
server.listen(port, host, () => console.log("SEAT ready at http://" + host + ":" + port + " | expert: " + (config.qwenApiKey ? config.qwenModel : "labelled local demo")));
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
async function shutdown() { await vite?.close(); await application.close(); process.exit(0); }
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
