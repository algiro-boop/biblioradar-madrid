// Genera el icono de BiblioRadar (SVG + PNG de la PWA + favicon.ico) desde una única fuente.
//   npm run icons
// Usa `sharp`, que ya instala Next.js para optimizar imágenes.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const C = 256; // centro del radar en un lienzo de 512

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [+(C + r * Math.cos(a)).toFixed(1), +(C + r * Math.sin(a)).toFixed(1)];
}

/**
 * @param {object} o
 * @param {boolean} o.rounded  esquinas redondeadas (favicon, "any"); iOS y "maskable" recortan ellos.
 * @param {number}  o.scale    tamaño del dibujo; "maskable" exige caber en el círculo central del 80 %.
 */
function iconSvg({ rounded, scale }) {
  const [sx, sy] = polar(200, -100); // borde trasero del barrido
  const [ex, ey] = polar(200, -20); // borde delantero
  const [gx, gy] = polar(150, -38); // eco verde
  const [ax, ay] = polar(170, 148); // eco ámbar
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e293b"/>
      <stop offset="1" stop-color="#0f172a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#10b981" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#10b981" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sweep" gradientUnits="userSpaceOnUse" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}">
      <stop offset="0" stop-color="#10b981" stop-opacity="0"/>
      <stop offset="1" stop-color="#10b981" stop-opacity="0.72"/>
    </linearGradient>
    <linearGradient id="pin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e2e8f0"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512"${rounded ? ' rx="112"' : ""} fill="url(#bg)"/>
  <g transform="translate(${C} ${C}) scale(${scale}) translate(${-C} ${-C})">
    <circle cx="${C}" cy="${C}" r="230" fill="url(#glow)"/>
    <g fill="none" stroke="#10b981" stroke-width="9">
      <circle cx="${C}" cy="${C}" r="200" stroke-opacity="0.3"/>
      <circle cx="${C}" cy="${C}" r="144" stroke-opacity="0.38"/>
      <circle cx="${C}" cy="${C}" r="88" stroke-opacity="0.46"/>
    </g>
    <path d="M${C} ${C} L${sx} ${sy} A200 200 0 0 1 ${ex} ${ey} Z" fill="url(#sweep)"/>
    <line x1="${C}" y1="${C}" x2="${ex}" y2="${ey}" stroke="#34d399" stroke-width="10" stroke-linecap="round"/>
    <circle cx="${ax}" cy="${ay}" r="30" fill="#f59e0b" fill-opacity="0.22"/>
    <circle cx="${ax}" cy="${ay}" r="15" fill="#fbbf24"/>
    <circle cx="${gx}" cy="${gy}" r="40" fill="#34d399" fill-opacity="0.22"/>
    <circle cx="${gx}" cy="${gy}" r="19" fill="#6ee7b7"/>
    <circle cx="${gx}" cy="${gy}" r="8" fill="#ffffff"/>
    <ellipse cx="${C}" cy="396" rx="46" ry="11" fill="#020617" fill-opacity="0.55"/>
    <path d="M256 390 C226 344 178 304 178 238 A78 78 0 0 1 334 238 C334 304 286 344 256 390 Z" fill="url(#pin)"/>
    <path d="M251 220 C236 208 216 203 202 205 V265 C216 263 236 267 251 279 Z" fill="#10b981"/>
    <path d="M261 220 C276 208 296 203 310 205 V265 C296 263 276 267 261 279 Z" fill="#059669"/>
  </g>
</svg>
`;
}

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

const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 * (size / 512) * 4 }).resize(size, size).png().toBuffer();

const rounded = iconSvg({ rounded: true, scale: 1 });
const fullBleed = iconSvg({ rounded: false, scale: 0.92 }); // iOS redondea las esquinas por su cuenta
const maskable = iconSvg({ rounded: false, scale: 0.78 });

await writeFile(`${PUBLIC}icon.svg`, rounded);
await writeFile(`${PUBLIC}icon-192.png`, await png(rounded, 192));
await writeFile(`${PUBLIC}icon-512.png`, await png(rounded, 512));
await writeFile(`${PUBLIC}icon-maskable-512.png`, await png(maskable, 512));
await writeFile(`${PUBLIC}apple-touch-icon.png`, await png(fullBleed, 180));
const favicon = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(rounded, size) })));
await writeFile(`${PUBLIC}favicon.ico`, ico(favicon));
console.log("Iconos generados en public/");
