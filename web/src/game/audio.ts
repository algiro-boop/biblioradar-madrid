/**
 * Música ambiente generada en el navegador con WebAudio: composiciones propias (sin archivos ni
 * licencias de terceros). Nunca suena sola: solo tras activarla el usuario, y se pausa al ocultar
 * la pestaña o salir de «Mi Biblioteca».
 */

export type Track = "lofi" | "jazz" | "rain";

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Progresiones (notas MIDI) y bajo de cada pista.
const LOFI_CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
const JAZZ_CHORDS = [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [57, 61, 64, 67]];
const RAIN_CHORDS = [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]];

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ambience: AudioScheduledSourceNode[] = [];
  private track: Track = "lofi";
  private step = 0;
  private nextTime = 0;
  private volume = 0.5;
  playing = false;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0;
      this.music.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // Ruido marrón suave (lluvia y crujido de vinilo).
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.music && this.ctx && this.playing) this.music.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.2);
  }

  async play(track: Track, volume: number) {
    const ctx = this.ensure();
    await ctx.resume();
    if (this.playing && track === this.track) return this.setVolume(volume);
    this.stop(true);
    this.track = track;
    this.volume = volume;
    this.playing = true;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.music!.gain.cancelScheduledValues(ctx.currentTime);
    this.music!.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.6);
    this.startAmbience();
    this.timer = setInterval(() => this.schedule(), 100);
  }

  stop(immediate = false) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    const ctx = this.ctx;
    if (!ctx || !this.music) return;
    this.music.gain.cancelScheduledValues(ctx.currentTime);
    this.music.gain.setTargetAtTime(0, ctx.currentTime, immediate ? 0.02 : 0.3);
    const nodes = this.ambience;
    this.ambience = [];
    setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* ya parado */ } }), immediate ? 60 : 1200);
  }

  /** Fondo continuo: crujido de vinilo (lo-fi), escobillas (jazz) o lluvia. */
  private startAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    if (this.track === "rain") {
      filter.type = "bandpass";
      filter.frequency.value = 1400;
      filter.Q.value = 0.4;
      gain.gain.value = 0.55;
    } else {
      filter.type = "highpass";
      filter.frequency.value = this.track === "lofi" ? 2500 : 5000;
      gain.gain.value = this.track === "lofi" ? 0.08 : 0.03;
    }
    src.connect(filter).connect(gain).connect(this.music!);
    src.start();
    this.ambience.push(src);
  }

  private schedule() {
    const ctx = this.ctx!;
    const bpm = this.track === "jazz" ? 96 : this.track === "lofi" ? 74 : 60;
    const eighth = 60 / bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.4) {
      this.beat(this.step, this.nextTime, eighth);
      // Swing en las corcheas del jazz y del lo-fi.
      const swing = this.track === "rain" ? 1 : this.step % 2 === 0 ? 1.18 : 0.82;
      this.nextTime += eighth * swing;
      this.step = (this.step + 1) % 64;
    }
  }

  private beat(step: number, t: number, eighth: number) {
    const bar = Math.floor(step / 8) % 4;
    const pos = step % 8;
    const chords = this.track === "jazz" ? JAZZ_CHORDS : this.track === "rain" ? RAIN_CHORDS : LOFI_CHORDS;
    const chord = chords[bar]!;
    if (pos === 0) chord.forEach((n, i) => this.pad(NOTE(n), t + i * 0.012, eighth * 7.5, this.track === "rain" ? 0.05 : 0.06));
    if (this.track === "lofi") {
      if (pos === 0 || pos === 5) this.kick(t);
      if (pos === 2 || pos === 6) this.snare(t, 0.1);
      if (pos % 2 === 1) this.hat(t, 0.03);
      if (pos === 0 || pos === 4) this.bass(NOTE(chord[0]! - 12), t, eighth * 3);
      if (Math.random() < 0.3) this.keys(NOTE(chord[Math.floor(Math.random() * 4)]! + 12), t, eighth * 2);
    } else if (this.track === "jazz") {
      // Contrabajo caminando y escobillas.
      if (pos % 2 === 0) {
        const walk = [0, 4, 7, 9][pos / 2]!;
        this.bass(NOTE(chord[0]! - 12 + walk), t, eighth * 1.8);
      }
      this.hat(t, pos % 2 ? 0.02 : 0.035);
      if (pos === 2 || pos === 6) this.snare(t, 0.05);
      if (Math.random() < 0.22) this.keys(NOTE(chord[Math.floor(Math.random() * 4)]! + 12), t, eighth * 1.5);
    } else {
      if (pos === 0) this.bass(NOTE(chord[0]! - 12), t, eighth * 7);
      if (Math.random() < 0.18) this.keys(NOTE(chord[Math.floor(Math.random() * 4)]! + 24), t, eighth * 4, 0.025);
      if (Math.random() < 0.25) this.drip(t + Math.random() * eighth);
    }
  }

  private env(t: number, dur: number, peak: number, attack = 0.02): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.music!);
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, out: AudioNode, detune = 0) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(freq: number, t: number, dur: number, peak: number) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1100;
    filter.connect(this.env(t, dur, peak, 0.4));
    this.osc("triangle", freq, t, dur, filter, -6);
    this.osc("sine", freq, t, dur, filter, 5);
  }

  private keys(freq: number, t: number, dur: number, peak = 0.05) {
    const filter = this.ctx!.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    filter.connect(this.env(t, dur, peak, 0.008));
    this.osc("sine", freq, t, dur, filter);
    this.osc("triangle", freq * 2, t, dur * 0.4, filter);
  }

  private bass(freq: number, t: number, dur: number) {
    const filter = this.ctx!.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    filter.connect(this.env(t, dur, 0.16, 0.01));
    this.osc("sine", freq, t, dur, filter);
    this.osc("triangle", freq, t, dur, filter);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    o.connect(this.env(t, 0.3, 0.32, 0.003));
    o.start(t);
    o.stop(t + 0.35);
  }

  private noise(t: number, dur: number, peak: number, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    src.connect(filter).connect(this.env(t, dur, peak, 0.004));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private snare(t: number, peak: number) {
    this.noise(t, 0.18, peak, "bandpass", 1800);
  }

  private hat(t: number, peak: number) {
    this.noise(t, 0.05, peak, "highpass", 7000);
  }

  private drip(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1400 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.06);
    o.connect(this.env(t, 0.09, 0.03, 0.002));
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Efectos breves de la interfaz (independientes de la música). */
  sfx(kind: "coin" | "place" | "level" | "click" | "error") {
    const ctx = this.ensure();
    void ctx.resume();
    const t = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = 0.25;
    out.connect(this.master!);
    const blip = (freq: number, at: number, dur: number, type: OscillatorType = "square", peak = 0.18) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      g.connect(out);
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g);
      o.start(at);
      o.stop(at + dur + 0.02);
    };
    if (kind === "coin") {
      blip(NOTE(83), t, 0.08);
      blip(NOTE(88), t + 0.07, 0.22);
    } else if (kind === "place") {
      blip(140, t, 0.12, "triangle", 0.4);
      blip(90, t + 0.02, 0.1, "sine", 0.3);
    } else if (kind === "level") {
      [72, 76, 79, 84].forEach((n, i) => blip(NOTE(n), t + i * 0.1, 0.3, "square", 0.14));
    } else if (kind === "error") {
      blip(160, t, 0.15, "sawtooth", 0.1);
    } else {
      blip(NOTE(91), t, 0.03, "square", 0.08);
    }
  }
}

let engine: Engine | null = null;

export function audio(): Engine {
  engine ??= new Engine();
  return engine;
}
