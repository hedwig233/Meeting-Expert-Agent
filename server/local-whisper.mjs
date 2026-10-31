import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { wavHeader } from './asr.mjs';

export function whisperConfig(root, env = process.env) {
  const manifestPath = join(root, 'data', 'whisper', 'installation.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const binary = env.WHISPER_BINARY ? resolve(root, env.WHISPER_BINARY) : manifest.binary;
  const model = env.WHISPER_MODEL ? resolve(root, env.WHISPER_MODEL) : manifest.model;
  const vadPath = env.WHISPER_VAD_MODEL ? resolve(root, env.WHISPER_VAD_MODEL) : join(root, 'data', 'whisper', 'ggml-silero-v5.1.2.bin');
  return { binary, model, modelName: model ? basename(model).replace(/^ggml-/, '').replace(/\.bin$/, '') : 'base', ready: Boolean(binary && model && existsSync(binary) && existsSync(model)), threads: Math.min(8, Math.max(1, Number(env.WHISPER_THREADS || 4))), vadModel: existsSync(vadPath) ? vadPath : undefined };
}

export function parseWhisperQuality(document, minConfidence = 0.4) {
  const segments = Array.isArray(document.transcription) ? document.transcription : [];
  const text = segments.map(s => String(s.text || '')).join('').replace(/\[.*?\]/g, '').trim();
  const probabilities = segments.flatMap(s => Array.isArray(s.tokens) ? s.tokens : []).filter(t => typeof t.p === 'number' && !String(t.text || '').startsWith('<|')).map(t => t.p);
  const confidence = probabilities.length ? probabilities.reduce((a, b) => a + b, 0) / probabilities.length : null;
  return { text, confidence, accepted: Boolean(text) && (confidence === null || confidence >= minConfidence) };
}

export async function transcribeLocal({ root, binary, model, pcm, signal, threads = 4, vadModel, prompt = '以下是简体中文会议记录。', withQuality = false }) {
  if (!binary || !model || !existsSync(binary) || !existsSync(model)) throw new Error('本地 Whisper 尚未安装，请运行 npm.cmd run whisper:setup 后重启服务。');
  const directory = join(root, 'data', 'asr', randomUUID()); mkdirSync(directory, { recursive: true });
  const input = join(directory, 'chunk.wav'), output = join(directory, 'transcript');
  try {
    writeFileSync(input, Buffer.concat([wavHeader(pcm.length), pcm]));
    const args = ['-m', model, '-f', input, '-l', 'zh', '-t', String(threads), '-otxt', '-ojf', '-of', output, '-nt', '-np', '-ng', '--prompt', prompt];
    if (vadModel) args.push('--vad', '-vm', vadModel);
    await promisify(execFile)(binary, args, { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024, signal });
    const result = parseWhisperQuality(JSON.parse(readFileSync(output + '.json', 'utf8')));
    return withQuality ? result : result.accepted ? result.text : '';
  } catch (error) { throw new Error(signal?.aborted ? '本地转写已取消。' : '本地 Whisper 转写失败，请检查安装、模型文件和运行权限。'); }
  finally {
    // Only remove known files created by this invocation; no recursive deletion.
    for (const file of [input, output + '.txt', output + '.json']) { try { unlinkSync(file); } catch {} }
    try { rmdirSync(directory); } catch {}
  }
}

export class LocalWhisperAsr {
  constructor({ transcribe, onFinal = () => {}, onError = () => {}, onUncertain = () => {}, onState = () => {}, onSegmentError = () => {}, backpressure = false, recoverSegmentErrors = false, label = '本地转写', maxPending = 3, energyThreshold = 0.008, silenceSeconds = 1.0, maxTurnSeconds = 12, minVoicedSeconds = 0.25, timeoutMs = 60000 }) {
    Object.assign(this, { transcribe, onFinal, onError, onUncertain, onState, onSegmentError, backpressure, recoverSegmentErrors, label, maxPending, energyThreshold, silenceSeconds, maxTurnSeconds, minVoicedSeconds, timeoutMs });
    this.active = null; this.preRoll = []; this.pending = []; this.running = false; this.error = null; this.closed = false; this.controllers = new Set();
    this.paused = false; this.lastState = '';
  }
  reportState() {
    if (this.backpressure && !this.active && this.pending.length >= this.maxPending) this.paused = true;
    else if (this.paused && this.pending.length <= 1) this.paused = false;
    const state = { pending: this.pending.length, processing: this.running, paused: this.paused };
    const serialized = JSON.stringify(state);
    if (!this.closed && serialized !== this.lastState) { this.lastState = serialized; this.onState(state); }
  }
  push(buffer, offset = 0) {
    if (this.error) throw this.error; if (this.closed) throw new Error('本地语音会话已关闭。');
    if (!buffer.length) return; if (buffer.length % 2) throw new Error('PCM16 音频长度必须是偶数。');
    // Frames already in flight may arrive after the client receives backpressure.
    if (this.paused) { this.preRoll = []; return; }
    let sum = 0; for (let i = 0; i < buffer.length; i += 2) sum += (buffer.readInt16LE(i) / 32768) ** 2;
    const speech = Math.sqrt(sum / (buffer.length / 2)) >= this.energyThreshold; const seconds = buffer.length / 32000;
    if (!this.active && !speech) { this.preRoll.push({ buffer: Buffer.from(buffer), offset }); while (this.preRoll.reduce((total, f) => total + f.buffer.length / 32000, 0) > 0.5) this.preRoll.shift(); return; }
    if (!this.active) {
      if (!this.backpressure && this.pending.length >= this.maxPending) throw new Error('本地转写速度不足，已暂停输入；请等待处理完成或使用更小的模型。');
      this.active = { start: this.preRoll[0]?.offset ?? offset, end: offset, frames: this.preRoll.map(f => f.buffer), duration: this.preRoll.reduce((n, f) => n + f.buffer.length / 32000, 0), silent: 0, voiced: 0 }; this.preRoll = [];
    }
    this.active.frames.push(Buffer.from(buffer)); this.active.duration += seconds; this.active.end = offset + seconds;
    this.active.silent = speech ? 0 : this.active.silent + seconds; if (speech) this.active.voiced += seconds;
    if (this.active.silent >= this.silenceSeconds || this.active.duration >= this.maxTurnSeconds) this.finish();
  }
  finish() {
    if (!this.active || this.closed || this.error) return;
    const turn = this.active; this.active = null; this.preRoll = [];
    if (turn.voiced < this.minVoicedSeconds) return;
    this.pending.push(turn); this.reportState(); void this.process();
  }
  async process() {
    if (this.running || this.closed || this.error) return; this.running = true;
    try {
      while (this.pending.length && !this.closed) {
        const turn = this.pending.shift(); const controller = new AbortController(); this.controllers.add(controller);
        this.reportState();
        let rejectAborted;
        const aborted = new Promise((_, reject) => { rejectAborted = () => reject(new Error(this.label + '超时或已取消。')); });
        controller.signal.addEventListener('abort', rejectAborted, { once: true });
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const output = await Promise.race([this.transcribe(Buffer.concat(turn.frames), controller.signal), aborted]);
          const result = typeof output === 'string' ? { text: output, accepted: true, confidence: null } : output;
          if (!this.closed && result.text?.trim()) {
            if (result.accepted === false) this.onUncertain({ start: turn.start, end: turn.end, confidence: result.confidence });
            else this.onFinal({ id: randomUUID(), text: result.text.trim(), start: turn.start, end: turn.end, confidence: result.confidence });
          }
        }
        catch (error) {
          if (this.closed) break;
          if (!this.recoverSegmentErrors) throw error;
          this.onSegmentError(new Error(error.message || this.label + '失败。'), { start: turn.start, end: turn.end });
        }
        finally { clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAborted); this.controllers.delete(controller); }
      }
    } catch (error) { if (!this.closed) { this.error = new Error(error.message || '本地转写失败。'); this.onError(this.error); this.pending = []; } }
    finally { this.running = false; this.reportState(); }
  }
  async drain() {
    if (this.error) throw this.error; this.finish();
    const deadline = Date.now() + this.timeoutMs * (this.pending.length + Number(this.running) + 1);
    while (this.running || this.pending.length) { if (this.error) throw this.error; if (this.closed) throw new Error('语音会话已关闭。'); if (Date.now() > deadline) throw new Error('等待' + this.label + '超时。'); await new Promise(r => setTimeout(r, 25)); }
    if (this.error) throw this.error;
  }
  close() { this.closed = true; this.pending = []; this.active = null; this.preRoll = []; for (const controller of this.controllers) controller.abort(); }
}
