import { mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

export function speechFailure(error, signal) {
  if (signal?.aborted) return '本地语音已取消。';
  let status; try { status = JSON.parse(String(error.stdout || '').trim()); } catch {}
  if (status?.code === 'NO_CHINESE_VOICE') return '当前运行服务的 Windows 进程没有可用中文音色，请检查其账户和中文语音安装。';
  if (status?.code === 'ALL_VOICES_FAILED') return 'Windows 中文音色均未能生成音频；失败阶段：' + status.stage + '。请执行 npm.cmd run tts:check 获取诊断。';
  if (status?.code === 'SPEECH_INITIALIZATION_FAILED') return 'Windows 语音组件初始化失败；阶段：' + status.stage + '。请从普通 Windows PowerShell 启动服务。';
  if (error.killed || error.code === 'ETIMEDOUT') return 'Windows 语音生成超时，请检查音色是否可用。';
  return 'Windows 语音进程执行失败（' + String(error.code || error.name || 'unknown') + '），请执行 npm.cmd run tts:check。';
}

export async function localSpeech({ text, root, signal, voice }) {
  if (process.platform !== 'win32') throw new Error('Windows 本地语音合成需要在 Windows 上运行。');
  if (typeof text !== 'string' || !text.trim() || text.length > 3000) throw new Error('语音文本必须为 1–3000 字。');
  const directory = join(root, 'data', 'speech', randomUUID()); mkdirSync(directory, { recursive: true });
  const input = join(directory, 'input.json'), output = join(directory, 'speech.wav');
  try {
    writeFileSync(input, JSON.stringify({ text, voice }));
    const process = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'local-speech.ps1'), '-InputPath', input, '-OutputPath', output], { windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024, signal });
    let status; try { status = JSON.parse(process.stdout.trim()); } catch {}
    return { audio: readFileSync(output), format: 'audio/wav', voice: status?.voice };
  } catch (error) { throw new Error(speechFailure(error, signal)); }
  finally { for (const file of [input, output]) { try { unlinkSync(file); } catch {} } try { rmdirSync(directory); } catch {} }
}
