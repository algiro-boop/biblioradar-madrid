/**
 * Banda sonora del anuncio: chiptune propio a 120 ppm (Do–Sol–Lam–Fa) y efectos sincronizados con
 * los `cues` que publica la página. Todo se sintetiza aquí (sin muestras de terceros) y sale como
 * WAV mono de 16 bits.
 */

const RATE = 44_100;

const note = (n) => 440 * 2 ** ((n - 69) / 12);
// Acordes por compás (MIDI de la tríada en la octava media).
const CHORDS = [
  [60, 64, 67], // Do
  [55, 59, 62], // Sol
  [57, 60, 64], // Lam
  [53, 57, 60], // Fa
];
// Melodía de cuatro compases (corcheas; null = silencio), sobre la progresión.
const MELODY = [
  [72, null, 76, 79, 76, null, 74, 72],
  [74, null, 71, 74, 79, null, 77, 74],
  [76, null, 72, 76, 81, null, 79, 76],
  [77, 76, 74, 72, 74, null, 72, null],
];

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderSoundtrack({ duration, musicStart, bpm, cues }) {
  const n = Math.ceil(duration * RATE);
  const music = new Float32Array(n);
  const fx = new Float32Array(n);
  const rand = makeRng(7);

  /** Suma una voz con envolvente ADSR sencilla. */
  const tone = (buf, t0, dur, freq, { wave = "square", vol = 0.2, duty = 0.5, attack = 0.004, release = 0.05, slide = 0 } = {}) => {
    const s0 = Math.floor(t0 * RATE);
    const len = Math.floor((dur + release) * RATE);
    let phase = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      if (s0 + i < 0) continue;
      const t = i / RATE;
      const f = freq * (slide ? 2 ** ((slide * t) / dur) : 1);
      phase = (phase + f / RATE) % 1;
      let v;
      if (wave === "square") v = phase < duty ? 1 : -1;
      else if (wave === "triangle") v = 1 - 4 * Math.abs(phase - 0.5);
      else v = Math.sin(phase * Math.PI * 2);
      const env = t < attack ? t / attack : t < dur ? 1 : Math.max(0, 1 - (t - dur) / release);
      buf[s0 + i] += v * env * vol;
    }
  };
  /** Ruido filtrado (paso alto o bajo de un polo) con caída exponencial. */
  const noise = (buf, t0, dur, { vol = 0.2, hp = 0, lp = 1, decay = 8, swell = false } = {}) => {
    const s0 = Math.floor(t0 * RATE);
    const len = Math.floor(dur * RATE);
    let low = 0;
    let prev = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      if (s0 + i < 0) continue;
      const t = i / RATE;
      const w = rand() * 2 - 1;
      low += lp * (w - low);
      const v = hp ? low - prev * hp : low;
      prev = low;
      const env = swell ? (t / dur) ** 2 * (1 - Math.max(0, (t - dur * 0.85) / (dur * 0.15))) : Math.exp(-t * decay);
      buf[s0 + i] += v * env * vol;
    }
  };
  const kick = (buf, t0, vol = 0.55) => tone(buf, t0, 0.16, 140, { wave: "sine", vol, slide: -2.2, release: 0.08 });
  const snare = (buf, t0, vol = 0.22) => {
    noise(buf, t0, 0.18, { vol, lp: 0.6, decay: 22 });
    tone(buf, t0, 0.05, 220, { wave: "triangle", vol: vol * 0.6, slide: -1 });
  };
  const hat = (buf, t0, vol = 0.07) => noise(buf, t0, 0.04, { vol, hp: 0.95, decay: 70 });

  // ---------------------------------------------------------------- gancho (0 → inicio de la música)
  tone(music, 0, musicStart - 0.1, note(36), { wave: "triangle", vol: 0.22, release: 0.1 });
  tone(music, 0, musicStart - 0.1, note(43), { wave: "square", duty: 0.25, vol: 0.04, release: 0.1 });
  noise(music, 0.6, musicStart - 0.6, { vol: 0.25, lp: 0.25, swell: true });
  // Redoble que acelera hasta el arranque.
  for (let t = 1.9; t < musicStart; ) {
    const k = (t - 1.9) / (musicStart - 1.9);
    snare(music, t, 0.08 + k * 0.14);
    t += 0.25 - k * 0.19;
  }

  // ---------------------------------------------------------------- canción (compases de 2 s)
  const beat = 60 / bpm;
  const bar = beat * 4;
  const end = duration - 2;
  // Tramos: la luz del día (31–35 s) va más suave; el final cierra con un acorde largo.
  const calm = (t) => t >= 31 && t < 35;
  for (let b = 0; musicStart + b * bar < end; b++) {
    const t0 = musicStart + b * bar;
    const chord = CHORDS[b % 4];
    const last = t0 + bar > end - 0.01;
    // Bajo en corcheas (fundamental y octava).
    for (let k = 0; k < 8; k++) {
      const t = t0 + (k * beat) / 2;
      const root = chord[0] - 24 + (k % 2 ? 12 : 0);
      tone(music, t, beat / 2 - 0.03, note(root), { wave: "triangle", vol: calm(t) ? 0.16 : 0.24, release: 0.02 });
    }
    // Arpegio en semicorcheas.
    const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
    for (let k = 0; k < 16; k++) {
      const t = t0 + (k * beat) / 4;
      const nn = chord[ARP[k % 8]] + 12 + (k >= 8 ? 12 : 0);
      tone(music, t, beat / 4 - 0.02, note(nn), { duty: 0.125, vol: calm(t) ? 0.035 : 0.05, release: 0.02 });
    }
    // Melodía: a partir del tercer compás, salvo en la parte tranquila.
    if (b >= 2 && !calm(t0)) {
      MELODY[b % 4].forEach((m, k) => {
        if (m !== null) tone(music, t0 + (k * beat) / 2, beat / 2 - 0.05, note(m), { duty: 0.5, vol: 0.075, release: 0.06 });
      });
    }
    // Batería.
    for (let k = 0; k < 4; k++) {
      const t = t0 + k * beat;
      if (calm(t)) {
        if (k === 0) kick(music, t, 0.35);
        hat(music, t, 0.05);
        hat(music, t + beat / 2, 0.04);
        continue;
      }
      kick(music, t);
      if (k % 2 === 1) snare(music, t);
      hat(music, t + beat / 2);
      if (b % 4 === 3 && k === 3) for (let j = 0; j < 4; j++) snare(music, t + (j * beat) / 4, 0.1 + j * 0.03);
    }
    if (last) break;
  }
  // Acorde final.
  const fin = end;
  kick(music, fin, 0.6);
  noise(music, fin, 1.4, { vol: 0.12, lp: 0.5, decay: 2.5 });
  for (const m of [48, 60, 64, 67, 72]) tone(music, fin, 1.6, note(m), { wave: m < 55 ? "triangle" : "square", duty: 0.25, vol: m < 55 ? 0.22 : 0.045, release: 0.6 });

  // ---------------------------------------------------------------- efectos
  for (const { t, kind } of cues) {
    switch (kind) {
      case "pop":
        tone(fx, t, 0.05, 620 + rand() * 200, { duty: 0.25, vol: 0.12, slide: 1, release: 0.02 });
        break;
      case "coin":
        tone(fx, t, 0.05, note(83), { duty: 0.5, vol: 0.11 });
        tone(fx, t + 0.05, 0.16, note(88), { duty: 0.5, vol: 0.11, release: 0.08 });
        break;
      case "whoosh":
        noise(fx, t - 0.22, 0.3, { vol: 0.3, lp: 0.35, swell: true });
        break;
      case "levelup":
        [72, 76, 79, 84].forEach((m, i) => tone(fx, t + i * 0.06, 0.07, note(m), { duty: 0.25, vol: 0.12, release: 0.03 }));
        tone(fx, t + 0.24, 0.25, note(88), { duty: 0.25, vol: 0.1, release: 0.15 });
        break;
      case "tap":
        noise(fx, t, 0.03, { vol: 0.25, hp: 0.6, decay: 120 });
        tone(fx, t, 0.02, 1400, { wave: "sine", vol: 0.12 });
        break;
      case "boom":
        tone(fx, t, 0.35, 120, { wave: "sine", vol: 0.5, slide: -1.6, release: 0.15 });
        noise(fx, t, 0.4, { vol: 0.18, lp: 0.15, decay: 7 });
        break;
      case "tick":
        tone(fx, t, 0.025, 1760 + rand() * 300, { duty: 0.5, vol: 0.06, release: 0.01 });
        break;
      case "sparkle":
        [96, 100, 103, 108, 103].forEach((m, i) => tone(fx, t + i * 0.045, 0.04, note(m), { wave: "triangle", vol: 0.05, release: 0.05 }));
        break;
      case "stamp":
        tone(fx, t, 0.2, 90, { wave: "sine", vol: 0.55, slide: -1, release: 0.1 });
        noise(fx, t, 0.25, { vol: 0.28, lp: 0.4, decay: 14 });
        break;
      case "check":
        tone(fx, t, 0.05, note(79), { duty: 0.25, vol: 0.09 });
        tone(fx, t + 0.06, 0.1, note(86), { duty: 0.25, vol: 0.09, release: 0.05 });
        break;
    }
  }

  // ---------------------------------------------------------------- mezcla
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const fadeOut = Math.min(1, Math.max(0, (duration - t) / 0.8));
    out[i] = Math.tanh((music[i] * 0.85 + fx[i]) * 1.1) * fadeOut;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const gain = 0.89 / (peak || 1);
  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * gain)) * 32767), 44 + i * 2);
  return data;
}
