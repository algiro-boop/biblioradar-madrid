/**
 * Catálogo de la especificación (§6): 90 permanentes + 60 especiales = 150 artículos comerciales,
 * más variantes exclusivas no comercializadas (regalos de nivel, rachas y logros).
 * Nombres, niveles, precios y tamaños son los del documento; `kind`, colores y `fx` describen
 * el sprite pixel art que se dibuja por código (arte original, sin licencias de terceros).
 */

export type Rarity = "P" | "R" | "E" | "L" | "X";
export type Layer = "floor" | "rug" | "wall" | "small";
export type Fx =
  | "glow" | "float" | "spin" | "rain" | "stars" | "gears" | "screen" | "sway" | "leaves" | "keys" | "flicker" | "water";

export type ArtKind =
  | "table" | "roundtable" | "desk" | "chair" | "stool" | "officechair" | "armchair" | "throne" | "bench" | "sofa"
  | "pouf" | "shelf" | "lowshelf" | "cornershelf" | "cart" | "books" | "plant" | "smallplant" | "tree" | "palm"
  | "planter" | "hangplant" | "vgarden" | "lamp" | "floorlamp" | "rug" | "frame" | "poster" | "clock" | "wallshelf"
  | "garland" | "sconce" | "curtain" | "board" | "globe" | "hourglass" | "vase" | "cushions" | "folding" | "counter"
  | "sign" | "coatrack" | "locker" | "infopanel" | "cabinet" | "newstand" | "vitrine" | "pc" | "monitor" | "printer"
  | "tvwall" | "terminal" | "coffeetable" | "record" | "vinylbox" | "speakers" | "piano" | "lightpiano" | "monument"
  | "window" | "trophy" | "plaque" | "statue" | "fountain" | "figurine" | "calendar";

export type Tag =
  | "seat" | "table" | "surface" | "pc" | "shelf" | "sofa" | "armchair" | "lamp" | "light" | "plant" | "wallart"
  | "separator" | "counter" | "welcome" | "rest" | "record" | "vinyl" | "piano" | "astral" | "culture" | "showcase"
  | "rug" | "decor";

export interface CatalogItem {
  id: string;
  name: string;
  /** Categoría de tienda tal y como figura en el documento. */
  category: string;
  rarity: Rarity;
  minLevel: number;
  /** 0 en los exclusivos: no se venden en la tienda. */
  price: number;
  w: number;
  h: number;
  interaction: string;
  kind: ArtKind;
  colors: string[];
  fx?: Fx;
  layer: Layer;
  tags: Tag[];
  /** Texto accesible de la pieza (lector de pantalla). */
  alt: string;
}

type Row = [id: string, name: string, cat: string, lvl: number, price: number, size: string, interaction: string,
  kind: ArtKind, colors: string, fx?: Fx | "", extra?: string];

// Paleta cálida común (maderas, telas y metales) para que todo el mobiliario case.
const C = {
  oak: "#b9824a", pine: "#ddb874", walnut: "#7a4f31", cherry: "#a24d3c", birch: "#ead7b0", dark: "#4a3426",
  marble: "#e7e3ec", white: "#f1ece2", green: "#5f8f5a", moss: "#6f7d3a", blue: "#4c78b5", navy: "#2c3f6e",
  teal: "#3f8f8a", mustard: "#d6a33a", red: "#b84a44", rose: "#d77f8e", purple: "#7b5aa6", gold: "#e0b04a",
  copper: "#c07a45", steel: "#8c9aa8", graphite: "#3d4450", cream: "#f3e2bf", sky: "#7cc4e8", night: "#26305a",
  leaf: "#4f9a52", leaf2: "#7cbf5a", clay: "#c4703f", glass: "#9fd6ec", neon: "#ff5fb0", mint: "#7fd6b0",
} as const;

const PERMANENT: Row[] = [
  ["P001", "Mesa de roble", "Mesas", 1, 10, "2x2", "estudiar", "table", `${C.oak},${C.walnut}`],
  ["P002", "Mesa redonda clara", "Mesas", 1, 12, "2x2", "estudiar", "roundtable", `${C.birch},${C.oak}`],
  ["P003", "Pupitre individual", "Mesas", 1, 8, "1x2", "estudiar", "desk", `${C.pine},${C.oak}`],
  ["P004", "Mesa de pino", "Mesas", 1, 10, "2x2", "estudiar", "table", `${C.pine},${C.oak}`],
  ["P005", "Mesa de nogal", "Mesas", 1, 15, "2x2", "estudiar", "table", `${C.walnut},${C.dark}`],
  ["P006", "Mesa rectangular larga", "Mesas", 1, 24, "3x2", "estudiar", "table", `${C.oak},${C.walnut}`],
  ["P007", "Mesa comunitaria", "Mesas", 1, 28, "4x2", "estudiar", "table", `${C.pine},${C.walnut}`],
  ["P008", "Mesa de mármol", "Mesas", 1, 34, "2x2", "estudiar", "table", `${C.marble},${C.steel}`],
  ["P009", "Mesa de lectura vintage", "Mesas", 1, 22, "2x2", "leer", "table", `${C.cherry},${C.dark}`, "", "lamp-on-top"],
  ["P010", "Mesa modular moderna", "Mesas", 1, 30, "3x2", "estudiar", "table", `${C.white},${C.graphite}`],
  ["P011", "Silla de madera", "Sillas", 1, 5, "1x1", "sentarse", "chair", `${C.oak},${C.walnut}`],
  ["P012", "Silla de mimbre", "Sillas", 1, 7, "1x1", "sentarse", "chair", `${C.birch},${C.pine}`],
  ["P013", "Taburete sencillo", "Sillas", 1, 5, "1x1", "sentarse", "stool", `${C.pine},${C.oak}`],
  ["P014", "Silla tapizada verde", "Sillas", 1, 9, "1x1", "sentarse", "chair", `${C.green},${C.walnut}`],
  ["P015", "Silla azul", "Sillas", 1, 8, "1x1", "sentarse", "chair", `${C.blue},${C.navy}`],
  ["P016", "Silla de oficina", "Sillas", 1, 15, "1x1", "sentarse", "officechair", `${C.graphite},${C.steel}`],
  ["P017", "Silla retro", "Sillas", 1, 12, "1x1", "sentarse", "chair", `${C.mustard},${C.walnut}`],
  ["P018", "Silla giratoria", "Sillas", 1, 18, "1x1", "sentarse", "officechair", `${C.red},${C.steel}`],
  ["P019", "Sillón individual", "Sillas", 3, 26, "2x2", "leer", "armchair", `${C.rose},${C.walnut}`],
  ["P020", "Silla de diseño", "Sillas", 1, 24, "1x1", "sentarse", "chair", `${C.white},${C.gold}`],
  ["P021", "Estantería baja", "Estanterías y libros", 1, 12, "2x1", "ordenar libros", "lowshelf", `${C.oak},${C.walnut}`],
  ["P022", "Estantería de pino", "Estanterías y libros", 1, 14, "2x1", "ordenar libros", "shelf", `${C.pine},${C.oak}`],
  ["P023", "Estantería alta", "Estanterías y libros", 1, 18, "2x1", "ordenar libros", "shelf", `${C.walnut},${C.dark}`],
  ["P024", "Estante mural", "Estanterías y libros", 1, 8, "2x1", "decorativo", "wallshelf", `${C.oak},${C.walnut}`],
  ["P025", "Pila de libros", "Estanterías y libros", 1, 5, "1x1", "decorativo", "books", `${C.red},${C.blue}`],
  ["P026", "Libros de colores", "Estanterías y libros", 1, 7, "1x1", "decorativo", "books", `${C.mustard},${C.teal}`],
  ["P027", "Carrito de libros", "Estanterías y libros", 1, 14, "1x2", "ordenar libros", "cart", `${C.steel},${C.red}`],
  ["P028", "Librería clásica", "Estanterías y libros", 1, 22, "3x1", "ordenar libros", "shelf", `${C.cherry},${C.dark}`],
  ["P029", "Estantería esquinera", "Estanterías y libros", 1, 19, "2x2", "ordenar libros", "cornershelf", `${C.oak},${C.walnut}`],
  ["P030", "Librería monumental", "Estanterías y libros", 12, 45, "4x1", "ordenar libros", "shelf", `${C.dark},${C.gold}`],
  ["P031", "Maceta de helecho", "Plantas y naturaleza", 2, 6, "1x1", "decorativo", "plant", `${C.leaf},${C.clay}`],
  ["P032", "Cactus pequeño", "Plantas y naturaleza", 2, 5, "1x1", "decorativo", "smallplant", `${C.leaf2},${C.clay}`],
  ["P033", "Ficus", "Plantas y naturaleza", 2, 10, "1x1", "decorativo", "tree", `${C.leaf},${C.white}`],
  ["P034", "Monstera", "Plantas y naturaleza", 2, 12, "1x1", "decorativo", "plant", `${C.green},${C.graphite}`],
  ["P035", "Planta colgante", "Plantas y naturaleza", 2, 8, "1x1", "decorativo", "hangplant", `${C.leaf2},${C.cream}`],
  ["P036", "Jardinera doble", "Plantas y naturaleza", 2, 14, "2x1", "decorativo", "planter", `${C.leaf},${C.walnut}`],
  ["P037", "Bonsái", "Plantas y naturaleza", 2, 16, "1x1", "decorativo", "smallplant", `${C.green},${C.navy}`],
  ["P038", "Palmera interior", "Plantas y naturaleza", 2, 20, "2x2", "decorativo", "palm", `${C.leaf2},${C.clay}`],
  ["P039", "Maceta de barro", "Plantas y naturaleza", 2, 6, "1x1", "decorativo", "smallplant", `${C.leaf},${C.clay}`],
  ["P040", "Jardín vertical", "Plantas y naturaleza", 2, 25, "3x1", "decorativo", "vgarden", `${C.leaf},${C.walnut}`],
  ["P041", "Lámpara de mesa", "Iluminación y cuadros", 2, 8, "1x1", "encender", "lamp", `${C.cream},${C.oak}`],
  ["P042", "Flexo verde", "Iluminación y cuadros", 2, 10, "1x1", "encender", "lamp", `${C.green},${C.steel}`],
  ["P043", "Lámpara de pie", "Iluminación y cuadros", 2, 13, "1x1", "encender", "floorlamp", `${C.cream},${C.dark}`],
  ["P044", "Guirnalda cálida", "Iluminación y cuadros", 2, 10, "2x1", "brillar", "garland", `${C.gold},${C.dark}`, "flicker"],
  ["P045", "Aplique mural", "Iluminación y cuadros", 2, 8, "1x1", "brillar", "sconce", `${C.gold},${C.copper}`],
  ["P046", "Cuadro botánico", "Iluminación y cuadros", 2, 7, "1x1", "decorativo", "frame", `${C.leaf},${C.oak}`],
  ["P047", "Póster de lectura", "Iluminación y cuadros", 2, 5, "1x1", "decorativo", "poster", `${C.sky},${C.red}`],
  ["P048", "Reloj de pared", "Iluminación y cuadros", 2, 8, "1x1", "decorativo", "clock", `${C.white},${C.walnut}`],
  ["P049", "Lámpara art déco", "Iluminación y cuadros", 2, 20, "1x1", "encender", "floorlamp", `${C.gold},${C.graphite}`],
  ["P050", "Cuadro paisaje", "Iluminación y cuadros", 2, 12, "2x1", "decorativo", "frame", `${C.sky},${C.gold}`],
  ["P051", "Alfombra beige", "Alfombras y decoración", 2, 10, "2x2", "decorativo", "rug", `${C.cream},${C.oak}`],
  ["P052", "Alfombra geométrica", "Alfombras y decoración", 2, 12, "2x2", "decorativo", "rug", `${C.teal},${C.mustard}`],
  ["P053", "Alfombra redonda", "Alfombras y decoración", 2, 12, "2x2", "decorativo", "rug", `${C.rose},${C.cream}`, "", "round"],
  ["P054", "Cojines de lectura", "Alfombras y decoración", 2, 6, "1x1", "decorativo", "cushions", `${C.mustard},${C.teal}`],
  ["P055", "Globo terráqueo", "Alfombras y decoración", 2, 15, "1x1", "decorativo", "globe", `${C.sky},${C.gold}`],
  ["P056", "Reloj de arena", "Alfombras y decoración", 2, 8, "1x1", "decorativo", "hourglass", `${C.cream},${C.walnut}`],
  ["P057", "Jarrón cerámico", "Alfombras y decoración", 2, 7, "1x1", "decorativo", "vase", `${C.teal},${C.white}`],
  ["P058", "Biombo decorativo", "Alfombras y decoración", 2, 20, "2x1", "separador", "folding", `${C.cream},${C.walnut}`],
  ["P059", "Panel de anuncios", "Alfombras y decoración", 2, 12, "2x1", "decorativo", "board", `${C.copper},${C.oak}`],
  ["P060", "Cortina cálida", "Alfombras y decoración", 2, 12, "2x1", "decorativo", "curtain", `${C.red},${C.gold}`],
  ["P061", "Mostrador sencillo", "Recepción y zonas", 4, 22, "3x1", "atender", "counter", `${C.oak},${C.cream}`],
  ["P062", "Señal de bienvenida", "Recepción y zonas", 4, 8, "1x1", "decorativo", "sign", `${C.cream},${C.green}`],
  ["P063", "Perchero", "Recepción y zonas", 4, 10, "1x1", "decorativo", "coatrack", `${C.walnut},${C.red}`],
  ["P064", "Taquilla pequeña", "Recepción y zonas", 4, 20, "2x1", "guardar", "locker", `${C.teal},${C.steel}`],
  ["P065", "Panel informativo", "Recepción y zonas", 4, 12, "2x1", "decorativo", "infopanel", `${C.white},${C.blue}`],
  ["P066", "Separador de estudio", "Recepción y zonas", 8, 15, "2x1", "separador", "folding", `${C.green},${C.oak}`],
  ["P067", "Mesa de consulta", "Recepción y zonas", 4, 25, "2x2", "estudiar", "table", `${C.white},${C.oak}`],
  ["P068", "Archivador", "Recepción y zonas", 4, 16, "1x1", "decorativo", "cabinet", `${C.steel},${C.graphite}`],
  ["P069", "Expositor de novedades", "Recepción y zonas", 4, 20, "2x1", "leer", "newstand", `${C.oak},${C.mustard}`],
  ["P070", "Vitrina de exposición", "Recepción y zonas", 11, 35, "2x1", "observar", "vitrine", `${C.walnut},${C.glass}`, "", "culture"],
  ["P071", "Ordenador básico", "Tecnología y trabajo", 7, 28, "1x1", "usar PC", "pc", `${C.white},${C.sky}`, "screen"],
  ["P072", "Escritorio informático", "Tecnología y trabajo", 7, 32, "2x2", "usar PC", "desk", `${C.graphite},${C.sky}`, "screen", "pc"],
  ["P073", "Monitor panorámico", "Tecnología y trabajo", 7, 35, "1x1", "usar PC", "monitor", `${C.graphite},${C.sky}`, "screen"],
  ["P074", "Impresora decorativa", "Tecnología y trabajo", 7, 20, "1x1", "decorativo", "printer", `${C.white},${C.graphite}`],
  ["P075", "Mesa con enchufes", "Tecnología y trabajo", 7, 30, "2x2", "estudiar", "table", `${C.white},${C.steel}`],
  ["P076", "Panel de silencio", "Tecnología y trabajo", 7, 15, "2x1", "decorativo", "poster", `${C.navy},${C.cream}`],
  ["P077", "Lámpara de lectura pro", "Tecnología y trabajo", 7, 18, "1x1", "encender", "lamp", `${C.graphite},${C.white}`],
  ["P078", "Pantalla informativa", "Tecnología y trabajo", 7, 40, "2x1", "animar pantalla", "tvwall", `${C.graphite},${C.sky}`, "screen"],
  ["P079", "Terminal de consulta", "Tecnología y trabajo", 7, 45, "2x1", "usar PC", "terminal", `${C.white},${C.teal}`, "screen"],
  ["P080", "Mesa tecnológica", "Tecnología y trabajo", 7, 55, "3x2", "usar PC", "desk", `${C.white},${C.sky}`, "screen", "pc"],
  ["P081", "Sofá de dos plazas", "Descanso, cultura y música", 9, 32, "3x2", "leer", "sofa", `${C.blue},${C.walnut}`],
  ["P082", "Sofá verde musgo", "Descanso, cultura y música", 9, 36, "3x2", "leer", "sofa", `${C.moss},${C.walnut}`],
  ["P083", "Sillón orejero", "Descanso, cultura y música", 9, 27, "2x2", "leer", "armchair", `${C.red},${C.dark}`],
  ["P084", "Mesa de café", "Descanso, cultura y música", 9, 18, "2x1", "decorativo", "coffeetable", `${C.walnut},${C.dark}`],
  ["P085", "Puf redondo", "Descanso, cultura y música", 9, 12, "1x1", "sentarse", "pouf", `${C.mustard},${C.cream}`],
  ["P086", "Tocadiscos de vinilo", "Descanso, cultura y música", 3, 28, "2x1", "girar disco, sin música", "record", `${C.walnut},${C.graphite}`, "spin"],
  ["P087", "Caja de vinilos", "Descanso, cultura y música", 3, 12, "1x1", "seleccionar disco", "vinylbox", `${C.oak},${C.red}`],
  ["P088", "Altavoces retro", "Descanso, cultura y música", 3, 20, "2x1", "decorativo", "speakers", `${C.walnut},${C.cream}`],
  ["P089", "Expositor cultural", "Descanso, cultura y música", 11, 35, "2x1", "observar", "vitrine", `${C.dark},${C.gold}`, "", "culture"],
  ["P090", "Piano vertical decorativo", "Descanso, cultura y música", 12, 55, "2x2", "tocar en silencio", "piano", `${C.dark},${C.white}`, "keys"],
];

const SPECIAL: Row[] = [
  ["R001", "Mesa azul medianoche", "Mesas", 1, 40, "3x2", "estudiar", "table", `${C.night},${C.gold}`],
  ["R002", "Mesa de ajedrez", "Mesas", 3, 47, "3x2", "estudiar", "table", `${C.white},${C.dark}`, "", "chess"],
  ["R003", "Mesa de cerezo", "Mesas", 1, 54, "3x2", "estudiar", "table", `${C.cherry},${C.dark}`],
  ["R004", "Mesa de mapas", "Mesas", 3, 61, "3x2", "estudiar", "table", `${C.cream},${C.walnut}`, "", "map"],
  ["R005", "Silla terciopelo", "Sillas", 1, 68, "1x1", "sentarse", "chair", `${C.purple},${C.gold}`],
  ["R006", "Silla biblioteca antigua", "Sillas", 1, 44, "1x1", "sentarse", "chair", `${C.dark},${C.red}`],
  ["R007", "Silla de ratán dorado", "Sillas", 1, 51, "1x1", "sentarse", "chair", `${C.gold},${C.cream}`],
  ["R008", "Banco de lectura", "Sillas", 3, 58, "1x1", "leer", "bench", `${C.oak},${C.green}`],
  ["R009", "Estantería arcoíris", "Estanterías", 1, 65, "1x1", "ordenar libros", "shelf", `${C.white},${C.rose}`, "", "rainbow"],
  ["R010", "Estantería de bambú", "Estanterías", 1, 41, "1x1", "ordenar libros", "shelf", `${C.birch},${C.moss}`],
  ["R011", "Estante lunar", "Estanterías", 3, 48, "1x1", "decorativo", "wallshelf", `${C.night},${C.cream}`, "stars", "astral"],
  ["R012", "Colección atlas", "Libros", 1, 55, "1x1", "decorativo", "books", `${C.navy},${C.gold}`],
  ["R013", "Ficus nocturno", "Plantas", 2, 62, "1x1", "decorativo", "tree", `${C.teal},${C.night}`, "glow"],
  ["R014", "Bonsái otoñal", "Plantas", 2, 69, "1x1", "decorativo", "smallplant", `${C.copper},${C.dark}`, "leaves"],
  ["R015", "Maceta de constelaciones", "Plantas", 2, 45, "1x1", "decorativo", "smallplant", `${C.mint},${C.night}`, "stars", "astral"],
  ["R016", "Lámpara seta", "Iluminación", 2, 52, "1x1", "encender", "lamp", `${C.red},${C.cream}`, "glow"],
  ["R017", "Flexo cobrizo", "Iluminación", 2, 59, "1x1", "encender", "lamp", `${C.copper},${C.dark}`],
  ["R018", "Cuadro de Madrid pixelado", "Decoración", 2, 66, "1x1", "decorativo", "frame", `${C.sky},${C.red}`, "", "madrid"],
  ["R019", "Alfombra de estrellas", "Decoración", 2, 42, "1x1", "decorativo", "rug", `${C.night},${C.gold}`, "stars", "astral"],
  ["R020", "Globo terráqueo antiguo", "Decoración", 2, 49, "1x1", "decorativo", "globe", `${C.cream},${C.copper}`],
  ["R021", "Tocadiscos cerezo", "Música", 3, 56, "2x1", "girar disco", "record", `${C.cherry},${C.dark}`, "spin"],
  ["R022", "Colección vinilos jazz", "Música", 3, 63, "1x1", "seleccionar disco", "vinylbox", `${C.navy},${C.gold}`],
  ["R023", "Sofá mostaza", "Sofás", 9, 70, "3x2", "leer", "sofa", `${C.mustard},${C.walnut}`],
  ["R024", "Terminal retro", "Tecnología", 7, 46, "1x1", "usar PC", "pc", `${C.cream},${C.green}`, "screen"],
  ["E001", "Mesa de cristal azul", "Mesas", 3, 80, "3x2", "estudiar", "table", `${C.glass},${C.steel}`, "glow"],
  ["E002", "Mesa astronómica", "Mesas", 3, 91, "3x2", "estudiar", "table", `${C.night},${C.gold}`, "stars", "astral"],
  ["E003", "Mesa de biblioteca gótica", "Mesas", 5, 102, "3x2", "estudiar", "table", `${C.dark},${C.purple}`],
  ["E004", "Mesa jardín interior", "Mesas", 5, 113, "3x2", "estudiar", "table", `${C.oak},${C.leaf}`, "sway", "garden"],
  ["E005", "Sillón de terciopelo real", "Sillas", 3, 124, "1x1", "leer", "throne", `${C.purple},${C.gold}`],
  ["E006", "Silla flotante decorativa", "Sillas", 5, 84, "1x1", "sentarse", "chair", `${C.mint},${C.white}`, "float"],
  ["E007", "Sofá media luna", "Sofás", 9, 95, "3x2", "leer", "sofa", `${C.navy},${C.gold}`, "", "astral"],
  ["E008", "Sofá nube", "Sofás", 9, 106, "3x2", "leer", "sofa", `${C.white},${C.sky}`, "float"],
  ["E009", "Librería espiral", "Estanterías", 5, 117, "2x1", "ordenar libros", "shelf", `${C.copper},${C.dark}`, "spin"],
  ["E010", "Librería de vitrales", "Estanterías", 5, 128, "2x1", "ordenar libros", "shelf", `${C.dark},${C.glass}`, "glow", "stained"],
  ["E011", "Pila de libros encantados", "Libros", 3, 88, "1x1", "brillar", "books", `${C.purple},${C.mint}`, "float"],
  ["E012", "Jardín zen animado", "Plantas", 5, 99, "1x1", "animación suave", "planter", `${C.birch},${C.leaf}`, "sway"],
  ["E013", "Árbol interior luminoso", "Plantas", 5, 110, "1x1", "brillar", "tree", `${C.mint},${C.white}`, "glow"],
  ["E014", "Lámpara luciérnagas", "Iluminación", 2, 121, "1x1", "brillar", "floorlamp", `${C.mint},${C.dark}`, "flicker"],
  ["E015", "Reloj astral", "Decoración", 6, 81, "1x1", "animar", "clock", `${C.night},${C.gold}`, "gears", "astral"],
  ["E016", "Alfombra mosaico", "Decoración", 2, 92, "1x1", "decorativo", "rug", `${C.teal},${C.copper}`, "", "mosaic"],
  ["E017", "Tocadiscos neón", "Música", 3, 103, "2x1", "girar disco", "record", `${C.graphite},${C.neon}`, "spin"],
  ["E018", "Cabina vinilos retro", "Música", 5, 114, "1x1", "seleccionar disco", "vinylbox", `${C.red},${C.cream}`, "glow"],
  ["E019", "Ordenador holográfico pixel", "Tecnología", 7, 125, "1x1", "usar PC", "pc", `${C.graphite},${C.mint}`, "float"],
  ["E020", "Vitrina museo nocturno", "Cultura", 11, 85, "2x1", "observar", "vitrine", `${C.night},${C.glass}`, "glow", "culture"],
  ["L001", "Mesa de libros flotantes", "Mesas", 3, 150, "3x2", "libros flotan", "table", `${C.walnut},${C.gold}`, "float", "floating-books"],
  ["L002", "Mesa aurora boreal", "Mesas", 5, 167, "3x2", "brillar", "table", `${C.night},${C.mint}`, "glow", "aurora"],
  ["L003", "Mesa relojero", "Mesas", 5, 184, "3x2", "engranajes", "table", `${C.copper},${C.dark}`, "gears"],
  ["L004", "Trono del lector", "Sillas", 3, 201, "1x1", "leer", "throne", `${C.red},${C.gold}`, "glow"],
  ["L005", "Sofá galaxia", "Sofás", 9, 218, "3x2", "brillar", "sofa", `${C.night},${C.purple}`, "stars", "astral"],
  ["L006", "Sofá jardín secreto", "Sofás", 9, 235, "3x2", "leer", "sofa", `${C.green},${C.rose}`, "sway"],
  ["L007", "Librería infinita", "Estanterías", 5, 151, "2x1", "animación ilusión", "shelf", `${C.night},${C.gold}`, "glow", "infinite"],
  ["L008", "Biblioteca miniatura viviente", "Estanterías", 5, 168, "1x1", "animar", "shelf", `${C.oak},${C.mint}`, "flicker"],
  ["L009", "Árbol de páginas", "Plantas", 5, 185, "1x1", "hojas animadas", "tree", `${C.cream},${C.walnut}`, "leaves"],
  ["L010", "Lámpara cometa", "Iluminación", 2, 202, "1x1", "cometa animado", "floorlamp", `${C.gold},${C.night}`, "stars", "astral"],
  ["L011", "Ventanal de lluvia", "Decoración", 6, 219, "1x1", "lluvia animada", "window", `${C.glass},${C.walnut}`, "rain"],
  ["L012", "Reloj de constelaciones", "Decoración", 6, 236, "1x1", "brillar", "clock", `${C.night},${C.mint}`, "stars", "astral"],
  ["L013", "Gramófono de estrellas", "Música", 3, 152, "2x1", "girar disco", "record", `${C.gold},${C.night}`, "stars", "astral"],
  ["L014", "Piano de luz silencioso", "Música", 12, 169, "2x1", "teclas iluminadas", "lightpiano", `${C.white},${C.mint}`, "keys"],
  ["L015", "Pantalla de galaxias", "Tecnología", 13, 186, "1x1", "animar pantalla", "monitor", `${C.night},${C.purple}`, "stars", "astral"],
  ["L016", "Monumento del conocimiento", "Cultura", 14, 203, "3x2", "brillar", "monument", `${C.marble},${C.gold}`, "glow", "culture"],
];

/** Variantes exclusivas: regalos de nivel, racha y logros. Nunca aparecen en la tienda ni se revenden. */
const EXCLUSIVE: Row[] = [
  ["X01", "Vitrina de logros", "Exclusivo", 1, 0, "2x1", "mostrar trofeos", "vitrine", `${C.oak},${C.glass}`, "", "showcase"],
  ["X02", "Placa de la segunda sala", "Exclusivo", 5, 0, "1x1", "decorativo", "plaque", `${C.gold},${C.walnut}`],
  ["X05", "Pantalla interactiva", "Exclusivo", 13, 0, "2x1", "animar pantalla", "tvwall", `${C.graphite},${C.mint}`, "screen"],
  ["X06", "Fuente de la lectura", "Exclusivo", 14, 0, "2x2", "agua animada", "fountain", `${C.marble},${C.sky}`, "water"],
  ["X07", "Estatua del gran lector", "Exclusivo", 15, 0, "2x2", "brillar", "statue", `${C.marble},${C.gold}`, "glow", "culture"],
  ["X09", "Calendario dorado", "Exclusivo", 1, 0, "1x1", "decorativo", "calendar", `${C.gold},${C.red}`],
  ["X10", "Trofeo de los cien días", "Exclusivo", 1, 0, "1x1", "brillar", "trophy", `${C.gold},${C.red}`, "glow"],
  ["X11", "Trofeo de constancia", "Exclusivo", 1, 0, "1x1", "decorativo", "trophy", `${C.steel},${C.blue}`],
  ["X12", "Copa legendaria", "Exclusivo", 1, 0, "1x1", "brillar", "trophy", `${C.gold},${C.purple}`, "glow"],
  ["X13", "Figura de gato", "Exclusivo", 1, 0, "1x1", "decorativo", "figurine", `${C.mustard},${C.white}`],
  ["X14", "Póster de vinilo", "Exclusivo", 1, 0, "1x1", "decorativo", "poster", `${C.graphite},${C.neon}`],
  ["X15", "Lámpara de la hora tranquila", "Exclusivo", 1, 0, "1x1", "encender", "lamp", `${C.mint},${C.dark}`, "glow"],
  ["X16", "Placa de la pequeña exposición", "Exclusivo", 1, 0, "1x1", "decorativo", "plaque", `${C.copper},${C.dark}`, "", "culture"],
  ["X17", "Vitrina grande de logros", "Exclusivo", 11, 0, "3x1", "mostrar trofeos", "vitrine", `${C.walnut},${C.gold}`, "glow", "showcase"],
];

const SEATS: ArtKind[] = ["chair", "stool", "officechair", "armchair", "throne", "bench", "sofa", "pouf"];
const SURFACES: ArtKind[] = ["table", "roundtable", "desk", "counter", "lowshelf", "coffeetable", "cabinet"];
const WALL: ArtKind[] = ["hangplant", "vgarden", "frame", "poster", "clock", "wallshelf", "garland", "sconce", "curtain",
  "board", "tvwall", "window", "plaque", "calendar"];
const SMALL: ArtKind[] = ["books", "smallplant", "lamp", "globe", "hourglass", "vase", "pc", "monitor", "printer",
  "vinylbox", "trophy", "figurine"];

function deriveTags(kind: ArtKind, interaction: string, extra: string): Tag[] {
  const tags = new Set<Tag>();
  if (SEATS.includes(kind)) tags.add("seat");
  if (kind === "table" || kind === "roundtable" || kind === "desk") tags.add("table");
  if (SURFACES.includes(kind)) tags.add("surface");
  if (kind === "pc" || kind === "monitor" || kind === "terminal" || extra.includes("pc")) tags.add("pc");
  if (["shelf", "lowshelf", "cornershelf", "cart"].includes(kind)) tags.add("shelf");
  if (kind === "sofa") tags.add("sofa");
  if (kind === "armchair" || kind === "throne") tags.add("armchair");
  if (kind === "lamp" || kind === "floorlamp" || kind === "sconce") tags.add("lamp");
  if (kind === "lamp" || kind === "floorlamp" || kind === "sconce" || kind === "garland" || interaction === "encender") tags.add("light");
  if (["plant", "smallplant", "tree", "palm", "planter", "hangplant", "vgarden"].includes(kind)) tags.add("plant");
  if (kind === "frame" || kind === "poster") tags.add("wallart");
  if (interaction === "separador") tags.add("separator");
  if (kind === "counter") tags.add("counter");
  if (kind === "sign") tags.add("welcome");
  if (["rug", "sofa", "armchair", "cushions", "pouf", "throne"].includes(kind)) tags.add("rest");
  if (kind === "record") tags.add("record");
  if (kind === "vinylbox") tags.add("vinyl");
  if (kind === "piano" || kind === "lightpiano") tags.add("piano");
  if (kind === "rug") tags.add("rug");
  if (extra.includes("astral")) tags.add("astral");
  if (extra.includes("culture")) tags.add("culture");
  if (extra.includes("showcase")) tags.add("showcase");
  if (interaction === "decorativo") tags.add("decor");
  return [...tags];
}

function layerFor(kind: ArtKind): Layer {
  if (kind === "rug") return "rug";
  if (WALL.includes(kind)) return "wall";
  if (SMALL.includes(kind)) return "small";
  return "floor";
}

function toItem(rarity: Rarity | null, [id, name, category, minLevel, price, size, interaction, kind, colors, fx, extra = ""]: Row): CatalogItem {
  const [w = 1, h = 1] = size.split("x").map(Number);
  return {
    id,
    name,
    category,
    rarity: rarity ?? (id[0] as Rarity),
    minLevel,
    price,
    w,
    h,
    interaction,
    kind,
    colors: colors.split(","),
    fx: fx || undefined,
    layer: layerFor(kind),
    tags: deriveTags(kind, interaction, extra),
    alt: `${name}, ${w}×${h} casillas`,
  };
}

/** Variante visual extra (ajedrez, mapa, arcoíris…) que usa el dibujante. */
export const ART_VARIANT: Record<string, string> = Object.fromEntries(
  [...PERMANENT, ...SPECIAL, ...EXCLUSIVE].filter((r) => r[10]).map((r) => [r[0], r[10] as string]),
);

export const PERMANENT_ITEMS: CatalogItem[] = PERMANENT.map((r) => toItem("P", r));
export const SPECIAL_ITEMS: CatalogItem[] = SPECIAL.map((r) => toItem(null, r));
export const EXCLUSIVE_ITEMS: CatalogItem[] = EXCLUSIVE.map((r) => toItem("X", r));
export const ALL_ITEMS: CatalogItem[] = [...PERMANENT_ITEMS, ...SPECIAL_ITEMS, ...EXCLUSIVE_ITEMS];

const BY_ID = new Map(ALL_ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): CatalogItem {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Artículo desconocido: ${id}`);
  return item;
}

export function findItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

export const RARITY_LABEL: Record<Rarity, string> = {
  P: "Permanente",
  R: "Raro",
  E: "Épico",
  L: "Legendario",
  X: "Exclusivo",
};

/** Categorías de los filtros de tienda e inventario, por tipo real de objeto (solo interfaz). */
export const ITEM_CATEGORIES = [
  "Mesas", "Sillas", "Sofás y sillones", "Estanterías y libros", "Plantas", "Iluminación", "Tecnología",
  "Pared y cuadros", "Alfombras", "Cultura y música", "Recepción", "Decoración",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

const CATEGORY_BY_KIND: Record<string, ItemCategory> = {
  table: "Mesas", roundtable: "Mesas", desk: "Mesas", coffeetable: "Mesas",
  chair: "Sillas", officechair: "Sillas", stool: "Sillas", bench: "Sillas", throne: "Sillas", pouf: "Sillas",
  sofa: "Sofás y sillones", armchair: "Sofás y sillones", cushions: "Sofás y sillones",
  shelf: "Estanterías y libros", wallshelf: "Estanterías y libros", cornershelf: "Estanterías y libros", lowshelf: "Estanterías y libros", books: "Estanterías y libros", cart: "Estanterías y libros",
  smallplant: "Plantas", plant: "Plantas", tree: "Plantas", planter: "Plantas", palm: "Plantas", hangplant: "Plantas", vgarden: "Plantas",
  lamp: "Iluminación", floorlamp: "Iluminación", sconce: "Iluminación", garland: "Iluminación",
  pc: "Tecnología", monitor: "Tecnología", printer: "Tecnología", terminal: "Tecnología", tvwall: "Tecnología", speakers: "Tecnología",
  frame: "Pared y cuadros", poster: "Pared y cuadros", clock: "Pared y cuadros", window: "Pared y cuadros", curtain: "Pared y cuadros", board: "Pared y cuadros", plaque: "Pared y cuadros", calendar: "Pared y cuadros",
  rug: "Alfombras",
  piano: "Cultura y música", lightpiano: "Cultura y música", record: "Cultura y música", vinylbox: "Cultura y música", monument: "Cultura y música",
  vitrine: "Cultura y música", statue: "Cultura y música", trophy: "Cultura y música", figurine: "Cultura y música", globe: "Cultura y música", hourglass: "Cultura y música",
  counter: "Recepción", cabinet: "Recepción", coatrack: "Recepción", infopanel: "Recepción", locker: "Recepción", newstand: "Recepción", sign: "Recepción", folding: "Recepción",
};

export function itemCategory(item: CatalogItem): ItemCategory {
  return CATEGORY_BY_KIND[item.kind] ?? (item.layer === "wall" ? "Pared y cuadros" : "Decoración");
}

/** Categorías de la tienda que cuentan para misiones y logros (agrupa las del documento). */
export function shopGroup(item: CatalogItem): string {
  const c = item.category;
  if (c.startsWith("Mesas")) return "Mesas";
  if (c.startsWith("Sillas") || c === "Sofás") return "Asientos";
  if (c.startsWith("Estanterías") || c === "Libros") return "Libros";
  if (c.startsWith("Plantas")) return "Plantas";
  if (c.startsWith("Iluminación")) return "Luz y cuadros";
  if (c.startsWith("Tecnología")) return "Tecnología";
  if (c.startsWith("Descanso") || c === "Música" || c === "Cultura") return "Cultura y música";
  return "Decoración";
}
