import WebSocket from "ws";
import { randomUUID } from "node:crypto";

// The existing local audio transport uses 16 kHz PCM16. Realtime transcription
// requires 24 kHz PCM16. Preserve interpolation state across incoming packets.
export class Pcm16To24 {
  constructor() { this.samples = 0; this.outputSamples = 0; this.previous = 0; }
  convert(buffer) {
    if (buffer.length % 2) throw new Error("PCM16 音频长度必须是偶数。");
    const out = [];
    for (let offset = 0; offset < buffer.length; offset += 2) {
      const current = buffer.readInt16LE(offset), index = this.samples++;
      while (this.outputSamples * 2 <= index * 3) {
        const position = this.outputSamples * 2 / 3;
        const value = index === 0 ? current : this.previous + (current - this.previous) * (position - (index - 1));
        out.push(Math.round(value)); this.outputSamples++;
      }
      this.previous = current;
    }
    return this.encode(out);
  }
  flush() {
    const out = [];
    while (this.outputSamples < Math.floor(this.samples * 3 / 2)) { out.push(this.previous); this.outputSamples++; }
    return this.encode(out);
  }
  encode(samples) { const result = Buffer.alloc(samples.length * 2); samples.forEach((s, i) => result.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2)); return result; }
}

export class OpenAiAsr {
  constructor({ apiKey, model = "gpt-live-transcribe", onPartial = () => {}, onFinal = () => {}, onError = () => {}, socketFactory = (url, options) => new WebSocket(url, options), silenceSeconds = 0.7, maxTurnSeconds = 12, energyThreshold = 0.008, timeoutMs = 20000 }) {
    if (!apiKey) throw new Error("请在后端配置 OPENAI_API_KEY。");
    Object.assign(this, { apiKey, model, onPartial, onFinal, onError, socketFactory, silenceSeconds, maxTurnSeconds, energyThreshold, timeoutMs });
    this.sessionId = randomUUID(); this.queue = []; this.queuedBytes = 0; this.ready = false; this.closed = false; this.error = null;
    this.active = null; this.preRoll = []; this.turns = []; this.unassigned = []; this.items = new Map(); this.earlyEvents = new Map(); this.partials = new Map();
  }
  open() {
    if (this.socket) return;
    this.socket = this.socketFactory("wss://api.openai.com/v1/realtime?intent=transcription", { headers: { Authorization: "Bearer " + this.apiKey }, handshakeTimeout: 10000 });
    this.timer = setTimeout(() => this.fail("OpenAI 语音会话初始化超时，请检查网络及 API 权限。"), 10000);
    this.socket.on("open", () => this.socket.send(JSON.stringify({ type: "session.update", session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: this.model }, turn_detection: null } } } })));
    this.socket.on("message", raw => {
      try { this.handle(JSON.parse(raw.toString())); } catch { this.fail("OpenAI 返回了无效的语音会话消息。"); }
    });
    this.socket.on("error", () => this.fail("无法连接 OpenAI 语音服务，请检查网络、API Key 和模型权限。"));
    this.socket.on("close", () => { clearTimeout(this.timer); if (!this.closed) this.fail("OpenAI 语音连接已中断，请重新开始音频会话。"); });
  }
  send(event) {
    if (this.error) throw this.error;
    if (this.closed) throw new Error("语音会话已经关闭。");
    const serialized = JSON.stringify(event);
    if (this.ready && this.socket.readyState === WebSocket.OPEN) {
      if (this.socket.bufferedAmount > 2 * 1024 * 1024) throw new Error("OpenAI 音频发送积压，请暂停输入。");
      this.socket.send(serialized);
    } else {
      this.queuedBytes += Buffer.byteLength(serialized);
      if (this.queuedBytes > 2 * 1024 * 1024) throw new Error("等待 OpenAI 连接时音频积压，请暂停输入。");
      this.queue.push(serialized);
    }
  }
  handle(event) {
    if (this.closed || this.error) return;
    if (event.type === "session.updated") {
      clearTimeout(this.timer); this.ready = true;
      for (const item of this.queue) this.socket.send(item);
      this.queue = []; this.queuedBytes = 0; return;
    }
    if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") { this.fail("OpenAI 语音识别失败，请检查音频格式、模型权限或账户额度。"); return; }
    if (event.type === "input_audio_buffer.committed") {
      const turn = this.unassigned.shift();
      if (!turn || !event.item_id) { this.fail("OpenAI 音频提交与识别结果未能关联。"); return; }
      turn.itemId = event.item_id; this.items.set(event.item_id, turn);
      for (const early of this.earlyEvents.get(event.item_id) || []) this.handle(early);
      this.earlyEvents.delete(event.item_id); return;
    }
    if (!["conversation.item.input_audio_transcription.delta", "conversation.item.input_audio_transcription.completed"].includes(event.type)) return;
    if (!event.item_id) return;
    const turn = this.items.get(event.item_id);
    if (!turn) {
      if (this.earlyEvents.size > 50) { this.fail("OpenAI 识别事件积压，请重新开始。"); return; }
      const events = this.earlyEvents.get(event.item_id) || []; events.push(event); this.earlyEvents.set(event.item_id, events); return;
    }
    if (event.type.endsWith(".delta")) {
      const text = (this.partials.get(event.item_id) || "") + String(event.delta || ""); this.partials.set(event.item_id, text);
      this.onPartial({ id: this.sessionId + "-" + event.item_id, text, start: turn.start });
    } else {
      turn.final = String(event.transcript || "").trim(); turn.completed = true;
      // Completion events may arrive out of order. Publish in audio-turn order.
      while (this.turns[0]?.completed) {
        const next = this.turns.shift();
        if (next.final) this.onFinal({ id: this.sessionId + "-" + next.itemId, text: next.final, start: next.start, end: next.end });
        this.items.delete(next.itemId); this.partials.delete(next.itemId);
      }
    }
  }
  push(buffer, offset = 0) {
    if (this.error) throw this.error;
    if (this.closed) throw new Error("语音会话已经关闭。");
    if (!buffer.length) return;
    if (buffer.length % 2 || !Number.isFinite(offset)) throw new Error("无效的 PCM16 音频。");
    this.open();
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 2) sum += (buffer.readInt16LE(i) / 32768) ** 2;
    const speech = Math.sqrt(sum / (buffer.length / 2)) >= this.energyThreshold;
    const seconds = buffer.length / 32000;
    if (!this.active && !speech) {
      this.preRoll.push({ buffer: Buffer.from(buffer), offset });
      while (this.preRoll.length > 2) this.preRoll.shift();
      return;
    }
    if (!this.active) {
      if (this.turns.length >= 8) throw new Error("OpenAI 转写处理积压，请暂停音频。");
      this.active = { start: this.preRoll[0]?.offset ?? offset, end: offset, duration: 0, silent: 0, voiced: 0, resampler: new Pcm16To24() };
      for (const frame of this.preRoll) this.append(frame.buffer, frame.offset);
      this.preRoll = [];
    }
    this.append(buffer, offset);
    this.active.silent = speech ? 0 : this.active.silent + seconds;
    if (speech) this.active.voiced += seconds;
    if (this.active.silent >= this.silenceSeconds || this.active.duration >= this.maxTurnSeconds) this.finish();
  }
  append(buffer, offset) {
    const audio = this.active.resampler.convert(buffer);
    if (audio.length) this.send({ type: "input_audio_buffer.append", audio: audio.toString("base64") });
    this.active.duration += buffer.length / 32000; this.active.end = offset + buffer.length / 32000;
  }
  finish() {
    if (!this.active || this.error || this.closed) return;
    const active = this.active; this.active = null; this.preRoll = [];
    const tail = active.resampler.flush();
    if (tail.length) this.send({ type: "input_audio_buffer.append", audio: tail.toString("base64") });
    if (active.duration < 0.1 || active.voiced < 0.05) { this.send({ type: "input_audio_buffer.clear" }); return; }
    const turn = { start: active.start, end: active.end, completed: false };
    this.turns.push(turn); this.unassigned.push(turn);
    this.send({ type: "input_audio_buffer.commit" });
  }
  async drain() {
    if (this.error) throw this.error;
    this.finish();
    const deadline = Date.now() + this.timeoutMs;
    while (this.turns.length || this.queue.length) {
      if (this.error) throw this.error;
      if (this.closed) throw new Error("语音会话已关闭。");
      if (Date.now() >= deadline) { this.fail("等待 OpenAI 最终转写超时，请稍后重试。"); throw this.error; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  fail(message) {
    if (this.error || this.closed) return;
    this.error = new Error(message); clearTimeout(this.timer); this.onError(this.error);
    this.socket?.terminate();
  }
  close() { this.closed = true; clearTimeout(this.timer); this.queue = []; this.preRoll = []; this.active = null; this.socket?.terminate(); }
}
