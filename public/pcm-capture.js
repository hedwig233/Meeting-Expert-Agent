// AudioWorklet: downmix, resample with continuous interpolation, emit PCM16 LE.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.inputIndex = 0; this.outputIndex = 0; this.previous = 0;
    this.frame = new Int16Array(1600); this.used = 0; this.energy = 0;
  }
  process(inputs, outputs) {
    const channels = inputs[0];
    if (channels?.length) {
      for (let i = 0; i < channels[0].length; i++) {
        let current = 0; for (const c of channels) current += c[i] || 0; current /= channels.length;
        const index = this.inputIndex++;
        while (this.outputIndex * sampleRate / 16000 <= index) {
          const position = this.outputIndex * sampleRate / 16000;
          const value = index === 0 ? current : this.previous + (current - this.previous) * (position - index + 1);
          this.frame[this.used++] = Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767));
          this.energy += value * value; this.outputIndex++;
          if (this.used === this.frame.length) {
            const data = new ArrayBuffer(this.frame.length * 2); const view = new DataView(data);
            for (let j = 0; j < this.frame.length; j++) view.setInt16(j * 2, this.frame[j], true);
            this.port.postMessage({ audio: data, rms: Math.sqrt(this.energy / this.used) }, [data]);
            this.used = 0; this.energy = 0;
          }
        }
        this.previous = current;
      }
    }
    // Never play captured meeting audio back to the output device.
    for (const channel of outputs[0] || []) channel.fill(0);
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
