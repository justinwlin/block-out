// Original Web Audio effects. No samples, so the PWA stays small and offline.

type Kind = 'grab' | 'tick' | 'bump' | 'exit' | 'thaw' | 'unlock' | 'room' | 'rocket' | 'ufo' | 'clock' | 'win' | 'fail' | 'ui';

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  unlock() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(kind: Kind) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const tone = (freq: number, dur: number, type: OscillatorType, gain: number, slide = 0) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master!);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    const noise = (dur: number, gain: number, hp = 400) => {
      const n = Math.floor(this.ctx!.sampleRate * dur);
      const buf = this.ctx!.createBuffer(1, n, this.ctx!.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx!.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = hp;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master!);
      src.start(t);
    };
    if (kind === 'grab') tone(210, 0.05, 'square', 0.08);
    else if (kind === 'tick') tone(520, 0.03, 'triangle', 0.04);
    else if (kind === 'bump') {
      noise(0.08, 0.12, 180);
      tone(90, 0.09, 'sine', 0.1);
    } else if (kind === 'exit') {
      tone(420, 0.16, 'triangle', 0.14, 380);
      tone(640, 0.18, 'sine', 0.06, 200);
      noise(0.1, 0.08, 900);
    } else if (kind === 'thaw') {
      noise(0.12, 0.1, 1200);
      tone(880, 0.14, 'sine', 0.07);
    } else if (kind === 'unlock') {
      tone(660, 0.08, 'square', 0.06);
      tone(880, 0.12, 'square', 0.05);
    } else if (kind === 'room') {
      tone(180, 0.16, 'triangle', 0.1);
      tone(540, 0.2, 'sine', 0.05, 220);
    } else if (kind === 'rocket') {
      noise(0.22, 0.16, 300);
      tone(300, 0.2, 'sawtooth', 0.05, -180);
    } else if (kind === 'ufo') {
      tone(520, 0.28, 'sine', 0.08, 300);
      tone(390, 0.28, 'triangle', 0.05, -120);
    } else if (kind === 'clock') tone(740, 0.2, 'sine', 0.08);
    else if (kind === 'win') {
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = this.ctx!.createOscillator();
        const g = this.ctx!.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        const st = t + i * 0.09;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.12, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
        o.connect(g);
        g.connect(this.master!);
        o.start(st);
        o.stop(st + 0.24);
      });
    } else if (kind === 'fail') {
      tone(330, 0.2, 'triangle', 0.08, -80);
      tone(196, 0.28, 'sine', 0.08, -40);
    } else tone(480, 0.04, 'sine', 0.06);
  }
}
