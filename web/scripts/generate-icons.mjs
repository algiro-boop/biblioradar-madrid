// Genera los PNG de la PWA a partir de public/icon.svg. Uso: npm run icons
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const svg = await readFile(`${publicDir}icon.svg`);

// Maskable: fondo a sangre y contenido dentro de la zona segura (80 %).
const maskable = Buffer.from(
  svg
    .toString()
    .replace('rx="112"', 'rx="0"')
    .replace(
      /(<rect[^>]*\/>)([\s\S]*)(<\/svg>)/,
      (_, rect, body, end) => `${rect}<g transform="translate(51.2 51.2) scale(0.8)">${body}</g>${end}`,
    ),
);

const outputs = [
  { file: "icon-192.png", size: 192, source: svg },
  { file: "icon-512.png", size: 512, source: svg },
  { file: "icon-maskable-512.png", size: 512, source: maskable },
  { file: "apple-touch-icon.png", size: 180, source: maskable },
];

for (const { file, size, source } of outputs) {
  await sharp(source, { density: 384 }).resize(size, size).png().toFile(`${publicDir}${file}`);
  console.log(`✓ public/${file}`);
}
