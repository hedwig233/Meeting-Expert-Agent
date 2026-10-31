import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { buildDuiSocketUrl } from "./dui-auth.mjs";

export function wavHeader(bytes, rate = 16000) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(bytes + 36, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(bytes, 40);
  return b;
}

// Cloud-to-cloud DUI full-chain protocol. Credentials stay on the backend.
// Each utterance is bounded to 12 seconds; ASR returns provisional and final text.
export class DuiAsr {
  constructor({ productId, apiKey, branch, deviceName, deviceSecret, onPartial, onFinal, onError }) {
    Object.assign(this, { productId, apiKey, branch, deviceName, deviceSecret, onPartial, onFinal, onError });
    this.channels = new Map(); this.closed = false;
  }
  push(data, offset = 0) {
    if (this.closed) return;
    let active = this.active;
    if (!active) active = this.open(offset);
    if (active.bytes + data.length > 384000) {
      this.finishActive(); active = this.open(offset);
    }
    active.bytes += data.length;
    if (active.socket.readyState === WebSocket.OPEN) active.socket.send(data);
    else active.queue.push(data);
  }
  open(offset) {
    if (this.channels.size >= 4) throw new Error("语音服务处理积压，请暂停音频并重试。");
    const url = buildDuiSocketUrl(this);
    const socket = new WebSocket(url, { handshakeTimeout: 10000 });
    const id = randomUUID();
    const item = { id, socket, queue: [], bytes: 0, offset, finished: false, emitted: false, lastText: "" };
    this.active = item; this.channels.set(id, item);
    item.timer = setTimeout(() => { this.onError(new Error("思必驰语音请求超时，请检查产品发布与 IP 授权。")); socket.terminate(); }, 40000);
    socket.on("open", () => {
      socket.send(JSON.stringify({ topic: "recorder.stream.start", recordId: id.replaceAll("-", ""), aiType: "asr", audio: { audioType: "wav", sampleRate: 16000, channel: 1, sampleBytes: 2 }, asrParams: { realBack: true, enableVAD: false, enablePunctuation: true } }));
      socket.send(wavHeader(384000));
      for (const data of item.queue) socket.send(data);
      item.queue = [];
      if (item.finished) socket.send(Buffer.alloc(0));
    });
    socket.on("message", data => {
      let payload; try { payload = JSON.parse(data.toString()); } catch { return; }
      if (payload.error || payload.topic === "sys.error") { this.onError(new Error("思必驰识别失败，请检查服务授权和音频格式。")); socket.close(); return; }
      const rec = payload.rec || payload.text || payload.asr?.text;
      if (typeof rec === "string" && rec.trim()) {
        item.lastText = rec.trim();
        if (payload.topic === "asr.result" || payload.isFinal === true) this.emitFinal(item);
        else this.onPartial({ id, text: rec, start: offset });
      }
      if (["asr.end", "dialog.end"].includes(payload.topic)) { this.emitFinal(item); socket.close(); }
    });
    socket.on("error", () => this.onError(new Error("无法连接思必驰服务，请检查网络、产品配置和 IP 授权。")));
    socket.on("close", () => { clearTimeout(item.timer); this.channels.delete(id); if (this.active === item) this.active = null; });
    return item;
  }
  emitFinal(item) {
    if (item.emitted || !item.lastText) return;
    item.emitted = true;
    this.onFinal({ id: item.id, text: item.lastText, start: item.offset, end: item.offset + item.bytes / 32000 });
    item.socket.close();
  }
  finishActive() { const item = this.active; if (!item) return; item.finished = true; if (item.socket.readyState === WebSocket.OPEN) item.socket.send(Buffer.alloc(0)); this.active = null; }
  finish() { this.finishActive(); }
  async drain() {
    this.finish();
    const deadline = Date.now() + 20000;
    while (this.channels.size && !this.closed) {
      if (Date.now() > deadline) throw new Error("等待最终转写超时，请稍后重试。");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  close() { this.closed = true; for (const item of this.channels.values()) { clearTimeout(item.timer); item.socket.terminate(); } this.channels.clear(); this.active = null; }
}
