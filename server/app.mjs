import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "./store.mjs";
import { localExpert, modelExpert } from "./expert.mjs";
import { DuiAsr } from "./asr.mjs";
import { OpenAiAsr } from "./openai-asr.mjs";
import { synthesizeSpeech } from "./openai-speech.mjs";
import { LocalWhisperAsr, transcribeLocal } from './local-whisper.mjs';
import { localSpeech } from './local-speech.mjs';
import { transcribeNextOmni } from './next-omni-asr.mjs';
import { synthesizeNextOmniSpeech } from './next-omni-speech.mjs';
import { DOCUMENT_SCOPES } from './knowledge.mjs';

export function createApplication({ root, database, config = {}, speechSynthesizer = synthesizeSpeech, nextSpeechSynthesizer = synthesizeNextOmniSpeech }) {
  const app = express(); const server = createServer(app); const store = createStore(root, database);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  const peers = new Map(); const jobs = new Map(); const speechJobs = new Map();
  const duiReady = Boolean(config.duiProductId && (config.duiApiKey || (config.duiDeviceName && config.duiDeviceSecret)));
  const selectedAsr = config.asrProvider || (config.openaiApiKey ? "openai" : "dui");
  const availableAsr = selectedAsr === 'next_omni' ? (config.nextApiKey ? 'next_omni' : 'sample') : selectedAsr === 'local' ? 'local' : selectedAsr === "openai" ? (config.openaiApiKey ? "openai" : "sample") : (duiReady ? "dui" : "sample");
  const asrReady = availableAsr === 'local' ? Boolean(config.localWhisper?.ready) : availableAsr !== 'sample';
  const speechProvider = config.speechProvider || 'openai';
  const speechAvailable = speechProvider === 'next_omni' ? Boolean(config.nextApiKey?.trim()) : speechProvider === 'windows' ? process.platform === 'win32' : Boolean(config.openaiApiKey);
  const speechModel = speechProvider === 'next_omni' ? config.nextSpeechModel || 'qwen3-omni-flash' : speechProvider === 'windows' ? 'Windows 中文语音' : config.openaiSpeechModel || 'gpt-realtime-2.1-mini';
  const speechVoice = speechProvider === 'next_omni' ? config.nextSpeechVoice || 'Cherry' : speechProvider === 'windows' ? config.windowsSpeechVoice || '系统中文音色' : config.openaiSpeechVoice || 'marin';
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== "http://" + req.headers.host && origin !== "https://" + req.headers.host) return res.status(403).json({ error: "只允许同源请求。" });
    res.setHeader("X-Content-Type-Options", "nosniff"); next();
  });
  app.use(express.json({ limit: "512kb" }));
  const send = (socket, event) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); };
  const broadcast = (id, event) => { for (const peer of peers.get(id) || []) send(peer, event); };
  const requireSession = (req, res, next) => { req.session = store.get(req.params.id); if (!req.session) return res.status(404).json({ error: "会议不存在。" }); next(); };
  const addSegment = (sessionId, segment) => {
    const s = store.get(sessionId);
    if (!s || s.status !== "active" || s.segments.some(x => x.id === segment.id)) return;
    if (s.segments.length >= 1000) throw new Error("当前会议已达到原型记录上限，请开启新会议。");
    s.segments.push({ ...segment, receivedAt: new Date().toISOString() }); store.save(s); broadcast(sessionId, { type: "segment", segment: s.segments.at(-1) });
  };
  app.get("/api/config", (req, res) => res.json({ expert: config.qwenApiKey ? "qwen" : "local", provider: config.qwenApiKey ? config.llmProvider || "qwen" : "local", asr: availableAsr, asrReady, asrModel: availableAsr === 'next_omni' ? (config.nextAsrModel || 'qwen3-omni-flash') + ' 分段云转写' : availableAsr === 'local' ? 'Whisper ' + (config.localWhisper?.modelName || 'base') + ' 本地分段转写' : availableAsr === "openai" ? config.openaiTranscriptionModel || "gpt-live-transcribe" : null, speech: speechAvailable, speechProvider, speechModel, speechVoice, model: config.qwenApiKey ? config.qwenModel : "本地规则演示", sources: store.documents().length }));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/demo", (req, res) => { try { res.json(JSON.parse(readFileSync(join(root, "public", "demo", "meeting.json"), "utf8"))); } catch { res.status(503).json({ error: "请先运行 npm run generate:audio 生成演示音频。" }); } });
  app.get("/api/documents", (req, res) => res.json(store.documents()));
  app.post("/api/documents", (req, res) => {
    const { title, content, scope = "shared" } = req.body || {};
    if (typeof title !== "string" || !title.trim() || title.length > 120 || typeof content !== "string" || !content.trim() || content.length > 100000) return res.status(400).json({ error: "请上传标题不超过 120 字、内容不超过 10 万字的文本资料。" });
    if (store.documents().length >= 30) return res.status(400).json({ error: "当前原型最多支持 30 份资料。" });
    if (!DOCUMENT_SCOPES.includes(scope)) return res.status(400).json({ error: "请选择公共、宫廷证据评审或技术方案评审知识范围。" });
    res.status(201).json(store.addDocument(title.trim(), content, scope));
  });
  app.patch("/api/documents/:id", (req, res) => {
    const { scope } = req.body || {};
    if (!DOCUMENT_SCOPES.includes(scope)) return res.status(400).json({ error: "未知知识范围。" });
    const document = store.setDocumentScope(req.params.id, scope);
    if (!document) return res.status(404).json({ error: "资料不存在。" });
    res.json(document);
  });
  app.post("/api/sessions", (req, res) => {
    const { title, expertRole } = req.body || {};
    if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 100)) return res.status(400).json({ error: "会议名称必须为 1–100 字。" });
    if (expertRole !== undefined && !["architecture", "evidence"].includes(expertRole)) return res.status(400).json({ error: "未知专家角色。" });
    res.status(201).json(store.createSession({ title: title?.trim(), expertRole }));
  });
  app.get("/api/sessions/:id", requireSession, (req, res) => res.json(req.session));
  app.post("/api/sessions/:id/segments", requireSession, (req, res) => {
    if (req.session.status !== "active") return res.status(409).json({ error: "会议已经结束。" });
    const { text, speaker } = req.body;
    if (typeof text !== "string" || !text.trim() || text.length > 4000) return res.status(400).json({ error: "请输入 1–4000 字的会议补充。" });
    const segment = { id: randomUUID(), text: text.trim(), speaker: typeof speaker === "string" ? speaker.slice(0, 40) : "参会者", start: req.session.audioSeconds, end: req.session.audioSeconds, source: "typed" };
    addSegment(req.params.id, segment); res.status(201).json(segment);
  });
  app.post("/api/sessions/:id/expert", requireSession, async (req, res) => {
    const id = req.params.id;
    if (req.session.status !== "active") return res.status(409).json({ error: "会议已经结束，请开启新会议。" });
    if (jobs.has(id)) return res.status(409).json({ error: "专家正在处理上一条请求。" });
    const question = req.body.question ?? "";
    if (typeof question !== "string" || question.length > 3000) return res.status(400).json({ error: "提问最多 3000 字。" });
    if (!req.session.segments.length) return res.status(400).json({ error: "请先播放一段会议，或输入讨论内容。" });
    const controller = new AbortController(); jobs.set(id, controller);
    const timeout = setTimeout(() => controller.abort(), 60000);
    const snapshot = structuredClone(req.session.segments);
    broadcast(id, { type: "expert.status", status: "thinking" });
    try {
      const options = { segments: snapshot, question, documents: store.documents(), history: req.session.messages, expertRole: req.session.expertRole || "architecture" };
      const result = config.qwenApiKey ? await modelExpert({ ...options, signal: controller.signal, apiKey: config.qwenApiKey, baseUrl: config.qwenBaseUrl, model: config.qwenModel, provider: config.llmProvider || "qwen", reasoningEffort: config.reasoningEffort }) : localExpert(options);
      if (controller.signal.aborted) throw new Error("请求已取消。");
      const s = store.get(id);
      const message = { ...result, id: randomUUID(), request: question, createdAt: new Date().toISOString(), contextSegmentIds: snapshot.map(x => x.id), contextSeconds: req.session.audioSeconds };
      s.messages.push(message); store.save(s); broadcast(id, { type: "expert.message", message }); res.json(message);
    } catch (error) { res.status(controller.signal.aborted ? 408 : 502).json({ error: controller.signal.aborted ? "专家请求已取消或超时。" : error.message }); }
    finally { clearTimeout(timeout); jobs.delete(id); broadcast(id, { type: "expert.status", status: "idle" }); }
  });
  app.post("/api/sessions/:id/cancel", requireSession, (req, res) => { jobs.get(req.params.id)?.abort(); speechJobs.get(req.params.id)?.abort(); res.json({ ok: true }); });
  app.post("/api/sessions/:id/speech", requireSession, async (req, res) => {
    if (!speechAvailable) return res.status(409).json({ error: speechProvider === 'next_omni' ? 'Qwen 专家语音尚未配置，请检查 NEXT_API_KEY。' : "语音服务尚未配置；Windows 本地语音不需要 API Key。" });
    if (req.session.status !== "active") return res.status(409).json({ error: "会议已经结束。" });
    if (speechJobs.has(req.params.id)) return res.status(409).json({ error: "上一条专家语音正在生成。" });
    let text;
    if (req.body.test === true) text = "这里是人工智能会议专家。如果你在腾讯会议中听到这句话，专家发言通道已接通。";
    else {
      const message = req.session.messages.find(m => m.id === req.body.messageId);
      if (!message) return res.status(400).json({ error: "请选择本场会议中已有的专家建议。" });
      text = (message.finding + " " + message.question + " " + message.proposal).slice(0, 1800);
    }
    const controller = new AbortController(); speechJobs.set(req.params.id, controller);
    const abort = () => { if (!res.writableEnded) controller.abort(); }; res.on("close", abort);
    try {
      let result;
      if (speechProvider === 'next_omni') result = await nextSpeechSynthesizer({ text, apiKey: config.nextApiKey, baseUrl: config.nextBaseUrl || 'https://api.openai-next.com/v1', model: speechModel, voice: speechVoice, style: config.nextSpeechStyle || '自然、清晰的中文会议发言语气', signal: controller.signal });
      else if (speechProvider === 'windows') result = await localSpeech({ text, root, voice: config.windowsSpeechVoice, signal: controller.signal });
      else result = await speechSynthesizer({ text, apiKey: config.openaiApiKey, model: speechModel, voice: speechVoice, signal: controller.signal });
      res.type(result.format).send(result.audio);
    } catch (error) { if (!res.destroyed) res.status(controller.signal.aborted ? 408 : 502).json({ error: error.message }); }
    finally { res.off("close", abort); speechJobs.delete(req.params.id); }
  });
  app.post("/api/sessions/:id/decisions", requireSession, (req, res) => {
    const s = req.session; if (s.status !== "active") return res.status(409).json({ error: "会议已经结束。" });
    const message = s.messages.find(m => m.id === req.body.messageId);
    if (!message) return res.status(400).json({ error: "找不到对应的专家建议。" });
    if (s.decisions.some(d => d.messageId === message.id)) return res.status(409).json({ error: "这项建议已记录。" });
    const text = typeof req.body.text === "string" ? req.body.text.trim().slice(0, 4000) : "";
    if (!text) return res.status(400).json({ error: "请填写确认后的决策。" });
    const decision = { id: randomUUID(), messageId: message.id, text, before: s.segments.filter(x => message.contextSegmentIds.includes(x.id)).map(x => x.speaker + "：" + x.text).join("\n"), owner: String(req.body.owner || "待确认").slice(0, 80), due: String(req.body.due || "待确认").slice(0, 80), createdAt: new Date().toISOString() };
    s.decisions.push(decision); store.save(s); broadcast(s.id, { type: "decision", decision }); res.status(201).json(decision);
  });
  app.post("/api/sessions/:id/end", requireSession, (req, res) => {
    if (jobs.has(req.params.id) || speechJobs.has(req.params.id)) return res.status(409).json({ error: "请先等待专家回答或取消请求。" });
    req.session.status = "ended"; store.save(req.session); broadcast(req.params.id, { type: "ended" }); res.json(req.session);
  });
  app.get("/api/sessions/:id/export", requireSession, (req, res) => {
    const s = req.session;
    const output = ["# " + s.title, "", "## 会议记录", ...s.segments.map(x => "- [" + x.start.toFixed(1) + "s] " + x.speaker + "：" + x.text), "", "## 专家评审", ...s.messages.map(m => "### " + m.contextSummary + "\n" + m.finding + "\n\n" + m.proposal + "\n\n依据：\n" + m.citations.map(c => "- " + c.title + " / " + c.heading + "\n  " + c.text).join("\n")), "", "## 已确认决策", ...s.decisions.map(d => "- " + d.text + "\n  负责人：" + d.owner + "；截止时间：" + d.due)];
    res.setHeader("Content-Type", "text/markdown; charset=utf-8"); res.setHeader("Content-Disposition", 'attachment; filename="meeting-review.md"'); res.send(output.join("\n"));
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws/meeting") return; // Vite HMR handles its own path.
    const origin = req.headers.origin;
    if (origin && origin !== "http://" + req.headers.host && origin !== "https://" + req.headers.host) { socket.destroy(); return; }
    const id = url.searchParams.get("session");
    if (!id || !store.get(id)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req, id));
  });
  wss.on("connection", (ws, req, id) => {
    if (!peers.has(id)) peers.set(id, new Set()); peers.get(id).add(ws);
    let asr = null; let audioSeconds = store.get(id).audioSeconds; let mode = "sample"; let cursor = 0; let demo = null;
    send(ws, { type: "connected", session: store.get(id) });
    ws.on("message", async (data, binary) => {
      try {
        const session = store.get(id); if (session.status !== "active") throw new Error("会议已经结束。");
        if (binary) {
          if (data.length > 16000 || data.length % 2 !== 0) throw new Error("无效的音频分块。");
          const offset = audioSeconds; audioSeconds += data.length / 32000;
          if (mode !== "sample") { if (!asr) throw new Error("语音连接尚未初始化。"); asr.push(data, offset); }
          const fresh = store.get(id); fresh.audioSeconds = audioSeconds; store.save(fresh);
          return;
        }
        const message = JSON.parse(data.toString());
        if (message.type === "stream.start") {
          asr?.close(); asr = null;
          if (!["sample", "dui", "openai", "local", "next_omni"].includes(message.mode)) throw new Error("未知的音频输入模式。");
          mode = message.mode;
          if (mode === 'next_omni') {
            if (availableAsr !== 'next_omni') throw new Error('请配置 NEXT_API_KEY 与 ASR_PROVIDER=next_omni，并先运行 npm.cmd run qwen:check 验证音频接口。');
            const hint = typeof message.hint === 'string' ? message.hint.slice(0, 80) : '';
            asr = new LocalWhisperAsr({
              label: 'Qwen 云端转写', backpressure: true, recoverSegmentErrors: true,
              transcribe: (pcm, signal) => transcribeNextOmni({ pcm, apiKey: config.nextApiKey, baseUrl: config.nextBaseUrl || 'https://api.openai-next.com/v1', model: config.nextAsrModel || 'qwen3-omni-flash', signal, hint, onPartial: text => { if (!signal.aborted) send(ws, { type: 'partial', segment: { text } }); } }),
              onFinal: segment => addSegment(id, { ...segment, speaker: '会议音频', source: 'next_omni' }),
              onState: state => send(ws, { type: 'asr.state', ...state }),
              onUncertain: () => send(ws, { type: 'asr.notice', text: 'Qwen 未听清该片段，请重说；该结果未加入专家上下文。后续片段将继续识别。' }),
              onSegmentError: error => send(ws, { type: 'asr.notice', text: error.message + ' 本片段未加入专家上下文，继续识别后续音频。' }),
              onError: error => send(ws, { type: 'error', error: error.message })
            });
          }
          else if (mode === 'local') {
            if (availableAsr !== 'local' || !asrReady) throw new Error('请在本机终端执行 npm.cmd run whisper:setup，完成后重启服务。');
            const hint = typeof message.hint === 'string' ? message.hint.slice(0, 80) : '';
            const terms = session.expertRole === 'evidence' ? '太医，甄嬛，温实初，白矾，水样，证据，发言。' : '接口，订单，幂等，超时，重试，服务端，发言。';
            const prompt = '以下是简体中文会议记录。术语：' + terms + (hint ? '常用口令：' + hint : '');
            asr = new LocalWhisperAsr({ transcribe: (pcm, signal) => transcribeLocal({ root, ...config.localWhisper, pcm, signal, prompt, withQuality: true }), onFinal: segment => addSegment(id, { ...segment, speaker: '会议音频', source: 'local_whisper' }), onUncertain: () => send(ws, { type: 'asr.notice', text: '有片段识别置信度较低，未加入专家上下文。请重说或补充文字。' }), onError: error => send(ws, { type: 'error', error: error.message }) });
          }
          else if (mode === "openai") {
            if (availableAsr !== "openai") throw new Error("请配置 ASR_PROVIDER=openai 和 OPENAI_API_KEY，再重启后端。");
            asr = new OpenAiAsr({ apiKey: config.openaiApiKey, model: config.openaiTranscriptionModel || "gpt-live-transcribe", onPartial: segment => send(ws, { type: "partial", segment }), onFinal: segment => addSegment(id, { ...segment, speaker: "会议音频", source: "openai" }), onError: error => send(ws, { type: "error", error: error.message }) });
          }
          else if (mode === "dui") {
            if (availableAsr !== "dui") throw new Error("当前未选择或未配置思必驰服务。");
            asr = new DuiAsr({ productId: config.duiProductId, apiKey: config.duiApiKey, deviceName: config.duiDeviceName, deviceSecret: config.duiDeviceSecret, branch: config.duiBranch || "prod", onPartial: segment => send(ws, { type: "partial", segment }), onFinal: segment => addSegment(id, { ...segment, speaker: "会议音频", source: "dui" }), onError: error => send(ws, { type: "error", error: error.message }) });
          } else {
            demo = JSON.parse(readFileSync(join(root, "public", "demo", "meeting.json"), "utf8"));
            cursor = 0;
          }
          send(ws, { type: "stream.ready", mode });
        } else if (message.type === "sample.progress" && mode === "sample" && demo) {
          const position = Math.min(Number(message.time) || 0, audioSeconds + 0.25);
          while (cursor < demo.segments.length && demo.segments[cursor].end <= position) {
            const segment = demo.segments[cursor++];
            addSegment(id, { ...segment, id: "sample-" + segment.id, source: "sample" });
          }
        } else if (message.type === "stream.flush") asr?.finish();
        else if (message.type === "stream.sync") { await asr?.drain(); send(ws, { type: "stream.synced" }); }
      } catch (error) { send(ws, { type: "error", error: error.message || "音频处理失败。" }); }
    });
    ws.on("error", () => {});
    ws.on("close", () => { asr?.close(); peers.get(id)?.delete(ws); if (!peers.get(id)?.size) peers.delete(id); });
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在。" }));
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(400).json({ error: "请求格式错误或数据过大。" }); });
  return { app, server, store, wss, async close() { for (const job of jobs.values()) job.abort(); for (const job of speechJobs.values()) job.abort(); for (const socket of wss.clients) socket.terminate(); await new Promise(resolve => wss.close(resolve)); if (server.listening) await new Promise(resolve => server.close(resolve)); store.close(); } };
}
