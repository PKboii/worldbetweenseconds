// Procedural spatial-ish audio. Everything is synthesized — silence is a sound too.

interface Mood {
  city: number; rain: number; freeze: number; future: number; past: number;
  void: number; instab: number; vel: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private beds: Record<string, GainNode> = {};
  private noiseSrc: AudioBufferSourceNode | null = null;
  private hbTimer: number | null = null;
  private tickTimer: number | null = null;
  private lastMood: Mood = { city: 0, rain: 0, freeze: 0, future: 0, past: 0, void: 0, instab: 0, vel: 0 };
  private started = false;

  begin() {
    if (this.started) { this.ctx?.resume(); return; }
    this.started = true;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.0;
      this.master.connect(ctx.destination);
      this.ramp(this.master.gain, 0.9, 4);

      // shared noise buffer (2s brown-ish)
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.start();
      this.noiseSrc = src;

      this.bed("city", 320, "lowpass", 0.0);
      this.bed("rain", 3400, "highpass", 0.0);
      this.bed("wind", 900, "bandpass", 0.0);
      this.bed("whoosh", 1400, "bandpass", 0.0);
      this.drone();
    } catch {
      this.ctx = null;
    }
  }

  private bed(name: string, freq: number, type: BiquadFilterType, vol: number) {
    if (!this.ctx || !this.master || !this.noiseSrc) return;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = 0.6;
    const g = this.ctx.createGain(); g.gain.value = vol;
    this.noiseSrc.connect(f); f.connect(g); g.connect(this.master);
    this.beds[name] = g;
  }

  private drone() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220;
    g.connect(lp); lp.connect(this.master);
    for (const [freq, type, det] of [[55, "sine", 0], [55.7, "triangle", 6], [110.3, "sine", -4]] as const) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = det;
      o.connect(g); o.start();
    }
    this.beds["drone"] = g;
  }

  private ramp(p: AudioParam, v: number, t: number) {
    if (!this.ctx) return;
    p.cancelScheduledValues(this.ctx.currentTime);
    p.setTargetAtTime(v, this.ctx.currentTime, Math.max(0.01, t / 3));
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.ramp(this.master.gain, m ? 0 : 0.9, 0.4);
  }

  // one-shots ---------------------------------------------------------------
  thump() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(64, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.22);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.34);
  }

  tick() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = 1800;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.05);
  }

  shatter() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.9);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.2);
  }

  ping() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 1180;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1);
  }

  // continuous mood ----------------------------------------------------------
  update(m: Mood, dt: number) {
    if (!this.ctx || !this.master) return;
    const L = this.lastMood;
    const sm = (a: number, b: number) => a + (b - a) * Math.min(1, dt * 2.5);
    const cur: Mood = {
      city: sm(L.city, m.city), rain: sm(L.rain, m.rain), freeze: sm(L.freeze, m.freeze),
      future: sm(L.future, m.future), past: sm(L.past, m.past), void: sm(L.void, m.void),
      instab: sm(L.instab, m.instab), vel: sm(L.vel, Math.min(1, m.vel)),
    };
    this.lastMood = cur;
    const g = this.beds;
    const set = (n: string, v: number) => { if (g[n]) this.ramp(g[n].gain, Math.max(0, Math.min(0.5, v)), 0.5); };
    set("city", 0.16 * cur.city * (1 - cur.freeze * 0.95) * (1 - cur.void));
    set("rain", 0.10 * cur.rain * (1 - cur.freeze * 0.9) * (1 - cur.void));
    set("wind", 0.09 * (cur.past * 0.8 + cur.future * 0.3 + cur.void * 0.5));
    set("whoosh", 0.22 * cur.vel * (1 - cur.freeze));
    set("drone", 0.05 + 0.12 * cur.future + 0.16 * cur.instab + 0.10 * cur.void - 0.04 * cur.city);

    // heartbeat while frozen
    if (cur.freeze > 0.55 && this.hbTimer === null) {
      this.hbTimer = window.setInterval(() => { this.thump(); }, 1150);
      this.thump();
    } else if (cur.freeze < 0.4 && this.hbTimer !== null) {
      clearInterval(this.hbTimer); this.hbTimer = null;
    }
    // clock ticks in the void
    if (cur.void > 0.55 && this.tickTimer === null) {
      this.tickTimer = window.setInterval(() => { this.tick(); }, 1000);
    } else if (cur.void < 0.4 && this.tickTimer !== null) {
      clearInterval(this.tickTimer); this.tickTimer = null;
    }
  }

  dispose() {
    if (this.hbTimer !== null) clearInterval(this.hbTimer);
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    try { this.ctx?.close(); } catch { /* noop */ }
    this.ctx = null;
  }
}
