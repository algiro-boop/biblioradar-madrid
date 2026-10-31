// Genera los iconos de BiblioRadar (PNG de la PWA, icono de iOS, favicon.ico y la miniatura de la
// cabecera) a partir del logo pixel art de `scripts/brand/logo.webp`.
//   npm run icons
// Usa `sharp`, que ya instala Next.js para optimizar imágenes.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const SOURCE = await readFile(new URL("./brand/logo.webp", import.meta.url));

// La tarjeta crema del logo dentro de la imagen original (1254 × 1254): se recorta a sangre y
// las esquinas redondeadas del original se rellenan con su mismo crema.
const CARD = { left: 110, top: 124, width: 1024, height: 1024 };
const CARD_RADIUS = 250;
const M = 1024; // lado del lienzo maestro
// Solo la ilustración (estante, gato, libros, lámpara y ventana), sin el nombre: a 16–48 px las
// letras serían una mancha, así que el favicon y la cabecera usan esta escena.
const SCENE = { left: 40, top: 26, width: 950, height: 650 };

const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${M}" height="${M}" viewBox="0 0 ${M} ${M}">${body}</svg>`);
const cream = svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fef4e8"/><stop offset="1" stop-color="#fdf0de"/></linearGradient></defs><rect width="${M}" height="${M}" fill="url(#g)"/>`);
const roundMask = (r) => svg(`<rect width="${M}" height="${M}" rx="${r}" fill="#fff"/>`);
const toPng = (pipeline) => pipeline.png().toBuffer();

/** Recorta un trozo y lo pega centrado sobre crema, ocupando `fill` del lado. */
async function onCream(input, fill) {
  const inner = await sharp(input).resize(Math.round(M * fill), Math.round(M * fill), { fit: "inside" }).png().toBuffer();
  return toPng(sharp(cream).composite([{ input: inner, gravity: "center" }]));
}

const card = await toPng(sharp(SOURCE).extract(CARD).composite([{ input: roundMask(CARD_RADIUS), blend: "dest-in" }]));
const master = await toPng(sharp(cream).composite([{ input: card }])); // logo completo a sangre
// «maskable»: Android puede recortar hasta un círculo del 80 %; el nombre debe quedar dentro.
const maskable = await onCream(master, 0.64);
const scene = await onCream(await toPng(sharp(master).extract(SCENE)), 0.94);

/** Esquinas redondeadas (iconos «any» y favicon); iOS y «maskable» recortan ellos. */
const rounded = (input) => toPng(sharp(input).composite([{ input: roundMask(M * 0.22), blend: "dest-in" }]));
const sized = async (input, size) => sharp(input).resize(size, size, { kernel: size <= 64 ? "lanczos3" : "mitchell" }).png().toBuffer();

/** ICO con PNG embebidos (válido en todos los navegadores actuales). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // planos
    header.writeUInt16LE(32, e + 6); // bits por píxel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const logo = await rounded(master);
const mark = await rounded(scene);
await writeFile(`${PUBLIC}icon-192.png`, await sized(logo, 192));
await writeFile(`${PUBLIC}icon-512.png`, await sized(logo, 512));
await writeFile(`${PUBLIC}icon-maskable-512.png`, await sized(maskable, 512));
await writeFile(`${PUBLIC}apple-touch-icon.png`, await sized(master, 180));
await writeFile(`${PUBLIC}icon-mark.png`, await sized(mark, 192));
const favicon = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await sized(mark, size) })));
await writeFile(`${PUBLIC}favicon.ico`, ico(favicon));
console.log("Iconos generados en public/");
