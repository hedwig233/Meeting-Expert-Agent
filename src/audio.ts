export async function decodePcm(file: Blob): Promise<Int16Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 900) throw new Error('首版支持最长 15 分钟音频。');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering(); const samples = rendered.getChannelData(0);
    return Int16Array.from(samples, value => Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)));
  } finally { await context.close(); }
}
export function time(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}
