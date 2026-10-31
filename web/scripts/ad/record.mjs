/**
 * Graba el anuncio de /mi-biblioteca/anuncio (servidor de desarrollo con el flag del juego):
 * pide cada fotograma en orden a Chromium sin ventana, guarda JPEG, sintetiza la banda sonora
 * y llama a `encode.swift` (AVFoundation) para el MP4 H.264 + AAC.
 *
 *   node scripts/ad/record.mjs [--url http://localhost:3100/mi-biblioteca/anuncio] [--frames dir] [--out anuncio.mp4] [--only 0-120]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { renderSoundtrack } from "./soundtrack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const url = arg("url", "http://localhost:3100/mi-biblioteca/anuncio");
const framesDir = resolve(arg("frames", join(here, ".frames")));
const out = resolve(arg("out", "anuncio/biblioradar-anuncio.mp4"));
const only = arg("only", null);

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("Error en la página:", e.message));
await page.goto(url);
await page.waitForFunction(() => !!window.__promo, null, { timeout: 120_000 });
const info = await page.evaluate(() => {
  const p = window.__promo;
  return { frames: p.frames, fps: p.fps, musicStart: p.musicStart, bpm: p.bpm, cues: p.cues };
});
const [from, to] = only ? only.split("-").map(Number) : [0, info.frames - 1];
console.log(`${info.frames} fotogramas a ${info.fps} fps; grabando ${from}–${to}`);

const save = (i, data) => writeFileSync(join(framesDir, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(data.split(",")[1], "base64"));
// El fotograma 0 ya está pintado al cargar; el resto se pide en orden.
if (from === 0) save(0, await page.evaluate(() => window.__promo.snapshot(0.93)));
const t0 = Date.now();
for (let i = 1; i <= to; i++) {
  const data = await page.evaluate(([k, keep]) => {
    window.__promo.renderFrame(k);
    return keep ? window.__promo.snapshot(0.93) : null;
  }, [i, i >= from]);
  if (data) save(i, data);
  if (i % 150 === 0) console.log(`  ${i}/${to} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();

if (only) {
  console.log(`Fotogramas en ${framesDir}`);
  process.exit(0);
}

const duration = info.frames / info.fps;
const wav = join(framesDir, "audio.wav");
writeFileSync(wav, renderSoundtrack({ duration, musicStart: info.musicStart, bpm: info.bpm, cues: info.cues }));
console.log("Banda sonora lista; codificando…");
execFileSync("swift", [join(here, "encode.swift"), framesDir, wav, out, String(info.fps)], { stdio: "inherit" });
console.log(`Vídeo: ${out}`);
