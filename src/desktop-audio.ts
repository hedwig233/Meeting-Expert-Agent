export interface DesktopCapture {
  stop(): Promise<void>;
}

export async function captureDesktop(onFrame: (audio: ArrayBuffer, rms: number) => void, onStopped: () => void): Promise<DesktopCapture> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前浏览器不支持屏幕音频采集，请在 Windows Chrome 或 Edge 中打开。');
  const options = { video: true, audio: true, systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' } as DisplayMediaStreamOptions;
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) { stream.getTracks().forEach(t => t.stop()); throw new Error('没有取得系统音频。请选择“整个屏幕”并勾选“共享系统音频”。浏览器未提供此选项时，本通道不可用。'); }
  const context = new AudioContext(); let stopped = false;
  try {
    await context.audioWorklet.addModule('/pcm-capture.js');
    const source = context.createMediaStreamSource(new MediaStream(audioTracks));
    const processor = new AudioWorkletNode(context, 'pcm-capture');
    const muted = context.createGain(); muted.gain.value = 0;
    source.connect(processor); processor.connect(muted); muted.connect(context.destination);
    processor.port.onmessage = event => { if (!stopped) onFrame(event.data.audio, event.data.rms); };
    await context.resume();
    const stop = async () => {
      if (stopped) return; stopped = true; processor.port.onmessage = null; source.disconnect(); processor.disconnect(); muted.disconnect();
      stream.getTracks().forEach(t => t.stop()); await context.close(); onStopped();
    };
    stream.getTracks().forEach(t => t.addEventListener('ended', () => { void stop(); }, { once: true }));
    return { stop };
  } catch (error) { stream.getTracks().forEach(t => t.stop()); await context.close(); throw error; }
}

export async function listOutputDevices(): Promise<MediaDeviceInfo[]> {
  // Permission is explicitly requested by the user pressing the device button.
  const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
  permission.getTracks().forEach(t => t.stop());
  return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

export async function routeAudio(element: HTMLAudioElement, deviceId: string) {
  if (!deviceId) throw new Error('先选择 CABLE Input 作为专家输出设备。');
  const routed = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (!routed.setSinkId) throw new Error('浏览器不支持指定音频输出，请改用 Windows Chrome 或 Edge。');
  await routed.setSinkId(deviceId);
}
