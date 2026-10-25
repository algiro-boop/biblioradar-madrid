import { BRAND_ICON_SRC } from "@/lib/brand";

// Ilustraciones tipo captura de pantalla para la guía de instalación (lienzo 300×150).
// Colores literales: imitan la interfaz real de Safari (azul #007aff) y Chrome (#1a73e8).

const URL_TEXT = "biblioradar-madrid.vercel.app";
const IOS_BLUE = "#007aff";
const ANDROID_BLUE = "#1a73e8";

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 300 150" role="img" aria-label={label} className="block h-auto w-full rounded-2xl ring-1 ring-slate-200">
      <rect width="300" height="150" fill="#f8fafc" />
      {children}
    </svg>
  );
}

/** Punto donde pulsar: anillo esmeralda que late. */
function Tap({ x, y }: { x: number; y: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r="16" fill="#10b981" fillOpacity="0.18">
        <animate attributeName="r" values="13;21;13" dur="1.6s" repeatCount="indefinite" />
        <animate attributeName="fill-opacity" values="0.3;0.05;0.3" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <circle cx={x} cy={y} r="13" fill="none" stroke="#10b981" strokeWidth="2.5" />
    </g>
  );
}

/** Contenido de fondo: cabecera de BiblioRadar y tarjetas de bibliotecas. */
function PageContent({ y = 12, faded = false }: { y?: number; faded?: boolean }) {
  return (
    <g opacity={faded ? 0.35 : 1}>
      <image href={BRAND_ICON_SRC} x="16" y={y} width="20" height="20" />
      <text x="42" y={y + 14} fontSize="11" fontWeight="800" fill="#0f172a">
        BiblioRadar
      </text>
      {[0, 1].map((i) => (
        <g key={i}>
          <rect x="16" y={y + 30 + i * 22} width="268" height="16" rx="6" fill="#ffffff" stroke="#e2e8f0" />
          <rect x="22" y={y + 34 + i * 22} width="22" height="8" rx="4" fill={i ? "#f59e0b" : "#10b981"} />
          <rect x="50" y={y + 35 + i * 22} width={i ? 110 : 150} height="6" rx="3" fill="#cbd5e1" />
        </g>
      ))}
    </g>
  );
}

function ShareGlyph({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${x - 7} ${y - 3} V${y + 8} H${x + 7} V${y - 3}`} />
      <path d={`M${x} ${y - 11} V${y + 3} M${x - 4} ${y - 7} L${x} ${y - 11} L${x + 4} ${y - 7}`} />
    </g>
  );
}

function AddSquareGlyph({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round">
      <rect x={x - 7} y={y - 7} width="14" height="14" rx="3.5" />
      <path d={`M${x} ${y - 3.5} V${y + 3.5} M${x - 3.5} ${y} H${x + 3.5}`} />
    </g>
  );
}

/** Mini pantalla de inicio con el icono ya instalado. */
function HomeScreen({ x, round = false }: { x: number; round?: boolean }) {
  const apps = [0, 1, 2, 3, 4, 5];
  return (
    <g>
      <rect x={x} y="14" width="88" height="122" rx="14" fill="#1e293b" />
      {apps.map((i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        return (
          <rect
            key={i}
            x={x + 10 + col * 25}
            y={24 + row * 30}
            width="18"
            height="18"
            rx={round ? 9 : 5}
            fill="#475569"
            opacity="0.7"
          />
        );
      })}
      <image href={BRAND_ICON_SRC} x={x + 25} y="86" width="38" height="38" />
      <text x={x + 44} y="132" fontSize="7.5" fontWeight="600" fill="#ffffff" textAnchor="middle">
        BiblioRadar
      </text>
    </g>
  );
}

function Arrow({ x }: { x: number }) {
  return (
    <path
      d={`M${x} 75 H${x + 16} M${x + 10} 69 L${x + 16} 75 L${x + 10} 81`}
      fill="none"
      stroke="#94a3b8"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export function IosShareBar() {
  return (
    <Frame label="Barra inferior de Safari con el botón Compartir resaltado">
      <PageContent />
      <rect x="0" y="80" width="300" height="70" fill="#f1f5f9" />
      <rect x="20" y="86" width="260" height="24" rx="12" fill="#e2e8f0" />
      <text x="32" y="102" fontSize="10" fontWeight="600" fill="#334155">
        aA
      </text>
      <text x="150" y="102" fontSize="9.5" fill="#334155" textAnchor="middle">
        {URL_TEXT}
      </text>
      <g fill="none" stroke={IOS_BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M44 127 L38 134 L44 141" />
        <path d="M94 127 L100 134 L94 141" opacity="0.35" />
        <path d="M199 128 C205 126 209 127 212 130 C215 127 219 126 225 128 V141 C219 139 215 140 212 143 C209 140 205 139 199 141 Z" />
        <rect x="252" y="126" width="12" height="12" rx="2" />
        <path d="M256 123 H266 A2 2 0 0 1 268 125 V134" />
      </g>
      <ShareGlyph x={150} y={135} color={IOS_BLUE} />
      <Tap x={150} y={133} />
    </Frame>
  );
}

export function IosShareSheet() {
  const rows = [
    { label: "Copiar", y: 70 },
    { label: "Añadir a favoritos", y: 96 },
    { label: "Añadir a pantalla de inicio", y: 122, active: true },
  ];
  return (
    <Frame label="Menú Compartir de Safari con la opción Añadir a pantalla de inicio resaltada">
      <rect x="0" y="6" width="300" height="144" rx="14" fill="#f2f2f7" />
      <rect x="135" y="11" width="30" height="4" rx="2" fill="#c7c7cc" />
      <image href={BRAND_ICON_SRC} x="16" y="22" width="26" height="26" />
      <text x="50" y="33" fontSize="10.5" fontWeight="700" fill="#0f172a">
        BiblioRadar Madrid
      </text>
      <text x="50" y="45" fontSize="8.5" fill="#64748b">
        {URL_TEXT}
      </text>
      <rect x="12" y="56" width="276" height="80" rx="10" fill="#ffffff" />
      {rows.map(({ label, y, active }) => (
        <g key={label}>
          {active && <rect x="14" y={y - 12} width="272" height="24" rx="8" fill="#ecfdf5" stroke="#10b981" strokeWidth="1.5" />}
          <text x="24" y={y + 4} fontSize="10.5" fontWeight={active ? 700 : 400} fill="#0f172a">
            {label}
          </text>
          {!active && <line x1="24" y1={y + 13} x2="288" y2={y + 13} stroke="#e5e5ea" />}
        </g>
      ))}
      <g fill="none" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="263" y="64" width="9" height="11" rx="2" />
        <path d="M267 61 H274 A1.5 1.5 0 0 1 275.5 62.5 V71" />
        <path d="M268 91 L270 96 L275 96.5 L271.2 99.8 L272.4 105 L268 102.2 L263.6 105 L264.8 99.8 L261 96.5 L266 96 Z" />
      </g>
      <AddSquareGlyph x={268} y={126} color="#0f172a" />
      <Tap x={268} y={126} />
    </Frame>
  );
}

export function IosConfirm() {
  return (
    <Frame label="Pantalla Añadir a inicio con el botón Añadir resaltado y el icono de BiblioRadar en la pantalla de inicio">
      <rect x="6" y="14" width="182" height="122" rx="12" fill="#f2f2f7" />
      <text x="14" y="34" fontSize="8.5" fill={IOS_BLUE}>
        Cancelar
      </text>
      <text x="97" y="34" fontSize="8.5" fontWeight="700" fill="#0f172a" textAnchor="middle">
        Añadir a inicio
      </text>
      <text x="180" y="34" fontSize="8.5" fontWeight="700" fill={IOS_BLUE} textAnchor="end">
        Añadir
      </text>
      <rect x="14" y="48" width="166" height="54" rx="9" fill="#ffffff" />
      <image href={BRAND_ICON_SRC} x="22" y="56" width="38" height="38" />
      <text x="68" y="72" fontSize="10.5" fontWeight="600" fill="#0f172a">
        BiblioRadar
      </text>
      <line x1="68" y1="78" x2="172" y2="78" stroke="#e5e5ea" />
      <text x="68" y="91" fontSize="7.5" fill="#64748b">
        biblioradar-madrid.vercel.app
      </text>
      <text x="97" y="122" fontSize="7.5" fill="#64748b" textAnchor="middle">
        Se añadirá un icono a tu pantalla de inicio
      </text>
      <Tap x={167} y={31} />
      <Arrow x={190} />
      <HomeScreen x={208} />
    </Frame>
  );
}

export function AndroidMenuButton() {
  return (
    <Frame label="Barra superior de Chrome con el menú de tres puntos resaltado">
      <rect x="0" y="0" width="300" height="44" fill="#ffffff" />
      <line x1="0" y1="44" x2="300" y2="44" stroke="#e2e8f0" />
      <rect x="12" y="10" width="226" height="24" rx="12" fill="#f1f3f4" />
      <g fill="none" stroke="#5f6368" strokeWidth="1.4">
        <rect x="23" y="20" width="8" height="7" rx="1.5" />
        <path d="M24.5 20 V17.5 A2.5 2.5 0 0 1 29.5 17.5 V20" />
      </g>
      <text x="38" y="26" fontSize="9.5" fill="#202124">
        {URL_TEXT}
      </text>
      <rect x="248" y="13" width="17" height="17" rx="4" fill="none" stroke="#5f6368" strokeWidth="1.6" />
      <text x="256.5" y="25.5" fontSize="9" fontWeight="700" fill="#5f6368" textAnchor="middle">
        1
      </text>
      {[15, 22, 29].map((cy) => (
        <circle key={cy} cx="284" cy={cy} r="2" fill="#5f6368" />
      ))}
      <Tap x={284} y={22} />
      <PageContent y={58} />
    </Frame>
  );
}

export function AndroidMenu() {
  const items = [
    { label: "Nueva pestaña", y: 54 },
    { label: "Historial", y: 78 },
    { label: "Instalar aplicación", y: 106, active: true },
    { label: "Configuración", y: 134 },
  ];
  return (
    <Frame label="Menú de Chrome con la opción Instalar aplicación resaltada">
      <PageContent y={52} faded />
      <rect x="0" y="0" width="300" height="34" fill="#ffffff" opacity="0.6" />
      <rect x="118" y="4" width="176" height="144" rx="10" fill="#ffffff" stroke="#e2e8f0" />
      <g fill="none" stroke="#5f6368" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M136 22 H148 M141 17 L136 22 L141 27" />
        <path d="M172 15 L174.5 20 L180 20.6 L176 24.3 L177 29.6 L172 27 L167 29.6 L168 24.3 L164 20.6 L169.5 20 Z" />
        <path d="M206 15 V26 M201.5 22 L206 26.5 L210.5 22 M200 29 H212" />
        <circle cx="240" cy="22" r="6.5" />
        <path d="M240 21 V25.5 M240 18.2 V18.4" />
        <path d="M276 17.5 A6.5 6.5 0 1 0 277.5 24 M276 13.5 V17.8 H271.8" />
      </g>
      <line x1="118" y1="38" x2="294" y2="38" stroke="#e2e8f0" />
      {items.map(({ label, y, active }) => (
        <g key={label}>
          {active && <rect x="122" y={y - 13} width="168" height="24" rx="7" fill="#ecfdf5" stroke="#10b981" strokeWidth="1.5" />}
          <text x="161" y={y + 3.5} fontSize="10" fontWeight={active ? 700 : 400} fill="#202124">
            {label}
          </text>
        </g>
      ))}
      <g fill="none" stroke="#5f6368" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M134 54 H146 M140 48 V60" />
        <circle cx="140" cy="78" r="6" />
        <path d="M140 75 V78 L142.5 79.5" />
        <circle cx="140" cy="134" r="5.5" />
      </g>
      <g fill="none" stroke="#202124" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="134.5" y="97" width="11" height="18" rx="2.5" />
        <path d="M140 101 V108 M137.2 105.5 L140 108.3 L142.8 105.5" />
      </g>
      <Tap x={140} y={106} />
    </Frame>
  );
}

export function AndroidConfirm() {
  return (
    <Frame label="Diálogo Instalar aplicación de Chrome con el botón Instalar resaltado y el icono en la pantalla de inicio">
      <rect x="8" y="22" width="168" height="106" rx="16" fill="#ffffff" stroke="#e2e8f0" />
      <text x="20" y="44" fontSize="11" fontWeight="700" fill="#202124">
        ¿Instalar aplicación?
      </text>
      <image href={BRAND_ICON_SRC} x="20" y="54" width="32" height="32" />
      <text x="60" y="67" fontSize="10" fontWeight="600" fill="#202124">
        BiblioRadar
      </text>
      <text x="60" y="80" fontSize="7.5" fill="#5f6368">
        biblioradar-madrid…
      </text>
      <text x="88" y="114" fontSize="9.5" fontWeight="600" fill={ANDROID_BLUE} textAnchor="middle">
        Cancelar
      </text>
      <rect x="120" y="100" width="48" height="20" rx="10" fill={ANDROID_BLUE} />
      <text x="144" y="113.5" fontSize="9.5" fontWeight="700" fill="#ffffff" textAnchor="middle">
        Instalar
      </text>
      <Tap x={144} y={110} />
      <Arrow x={182} />
      <HomeScreen x={204} round />
    </Frame>
  );
}
