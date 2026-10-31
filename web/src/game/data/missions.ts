/**
 * 45 misiones diarias y 30 semanales (§7). Cada regla es verificable con eventos reales del
 * juego o de la app; las de reporte solo avanzan con reportes válidos.
 */

export type MissionCategory = "contribution" | "decoration" | "exploration" | "community";

export type MissionRule =
  // Reportes (diarias: día actual; semanales: semana actual)
  | { type: "reports"; n: number }
  | { type: "reportDays"; n: number }
  | { type: "reportWeekdays"; days: number[] }
  | { type: "reportNonConsecutive" }
  // Editor (se evalúan al guardar una distribución real)
  | { type: "placeNew"; n: number }
  | { type: "saveWithMin"; n: number }
  | { type: "adjacent"; a: "seat" | "pc"; b: "table" | "seat" }
  | { type: "validChange" }
  | { type: "placeTag"; tag: "lamp" | "plant" | "wallart" }
  | { type: "decorChange" }
  | { type: "roomTags"; tags: string[]; zone?: boolean }
  | { type: "catRest" }
  | { type: "placeKind"; kinds: string[] }
  | { type: "roomsWithMin"; rooms: number; n: number }
  | { type: "floorChanged" }
  | { type: "uniqueTag"; tag: "separator"; n: number }
  | { type: "roomDistinct"; n: number }
  | { type: "saveDays"; n: number }
  | { type: "categories"; n: number }
  | { type: "plantsLamp" }
  | { type: "pcSeats"; n: number }
  // Exploración
  | { type: "realViews"; n: number; mode?: "notHabitual" | "new7d" }
  | { type: "virtualVisits"; n: number; room?: boolean }
  | { type: "like" }
  | { type: "nameSaved" }
  | { type: "showcaseChanged" }
  | { type: "musicSaved" }
  | { type: "levelUp" }
  | { type: "mixedViews"; real: number; virtual: number }
  // Comunitarias (objetivo global con instantánea semanal)
  | { type: "community"; metric: "reports" | "users" | "libraryReports" | "userDays" | "libraries" | "libraryUsers"; example: number };

export interface MissionDef {
  id: string;
  name: string;
  category: MissionCategory;
  minLevel: number;
  goal: string;
  reward: number;
  rule: MissionRule;
  /** Las de reporte son variantes narrativas del mismo objetivo: nunca dos a la vez. */
  equivalence?: string;
}

const report1 = (id: string, name: string, goal = "1 reporte válido"): MissionDef => ({
  id, name, category: "contribution", minLevel: 1, goal, reward: 8, rule: { type: "reports", n: 1 }, equivalence: "report1",
});

export const DAILY_MISSIONS: MissionDef[] = [
  report1("D01", "Primera ayuda", "1 reporte válido hoy"),
  report1("D02", "Dato del día", "1 reporte válido hoy"),
  report1("D03", "Información útil", "1 reporte válido hoy"),
  report1("D04", "Tu granito", "1 reporte válido hoy"),
  report1("D05", "Biblioteca al día", "1 reporte válido hoy"),
  { ...report1("D06", "Constancia diaria", "1 día con reporte válido"), rule: { type: "reportDays", n: 1 } },
  report1("D07", "Buen comienzo", "1 reporte válido antes de acabar el día"),
  report1("D08", "Actualización fiable", "1 reporte válido no duplicado"),
  report1("D09", "Punto de información"),
  report1("D10", "Reportero responsable"),
  report1("D11", "Aportación de hoy"),
  report1("D12", "Señal de vida"),
  report1("D13", "En la comunidad"),
  report1("D14", "Turno informativo"),
  report1("D15", "Información compartida"),
  { id: "D16", name: "Primer toque", category: "decoration", minLevel: 1, goal: "Colocar 1 objeto desde inventario", reward: 5, rule: { type: "placeNew", n: 1 } },
  { id: "D17", name: "Tu rincón", category: "decoration", minLevel: 1, goal: "Guardar una distribución con al menos 3 muebles", reward: 5, rule: { type: "saveWithMin", n: 3 } },
  { id: "D18", name: "Un lugar para leer", category: "decoration", minLevel: 1, goal: "Colocar una silla junto a una mesa", reward: 8, rule: { type: "adjacent", a: "seat", b: "table" } },
  { id: "D19", name: "Biblioteca ordenada", category: "decoration", minLevel: 1, goal: "Guardar distribución sin colisiones", reward: 5, rule: { type: "validChange" } },
  { id: "D20", name: "Luz cálida", category: "decoration", minLevel: 2, goal: "Colocar 1 lámpara", reward: 5, rule: { type: "placeTag", tag: "lamp" } },
  { id: "D21", name: "Un poco de verde", category: "decoration", minLevel: 2, goal: "Colocar 1 planta", reward: 5, rule: { type: "placeTag", tag: "plant" } },
  { id: "D22", name: "Galería pequeña", category: "decoration", minLevel: 2, goal: "Colocar 1 cuadro", reward: 5, rule: { type: "placeTag", tag: "wallart" } },
  { id: "D23", name: "Cambio de ambiente", category: "decoration", minLevel: 2, goal: "Cambiar y guardar 1 elemento decorativo", reward: 5, rule: { type: "decorChange" } },
  { id: "D24", name: "Rincón lector", category: "decoration", minLevel: 3, goal: "Colocar sillón y estantería en una sala", reward: 8, rule: { type: "roomTags", tags: ["armchair", "shelf"] } },
  { id: "D25", name: "Casa del gato", category: "decoration", minLevel: 3, goal: "Situar un lugar de descanso accesible al gato", reward: 8, rule: { type: "catRest" } },
  { id: "D26", name: "Recepción preparada", category: "decoration", minLevel: 4, goal: "Colocar el mostrador de recepción", reward: 8, rule: { type: "placeKind", kinds: ["counter"] } },
  { id: "D27", name: "Dos ambientes", category: "decoration", minLevel: 5, goal: "Decorar ambas salas con al menos 2 objetos cada una", reward: 12, rule: { type: "roomsWithMin", rooms: 2, n: 2 } },
  { id: "D28", name: "Cambio de suelo", category: "decoration", minLevel: 6, goal: "Aplicar un suelo distinto y guardar", reward: 8, rule: { type: "floorChanged" } },
  { id: "D29", name: "Espacio digital", category: "decoration", minLevel: 7, goal: "Colocar un PC junto a un asiento", reward: 8, rule: { type: "adjacent", a: "pc", b: "seat" } },
  { id: "D30", name: "Zona tranquila", category: "decoration", minLevel: 8, goal: "Colocar 2 separadores distintos", reward: 12, rule: { type: "uniqueTag", tag: "separator", n: 2 } },
  { id: "D31", name: "Explorador local", category: "exploration", minLevel: 1, goal: "Consultar la ficha de 1 biblioteca real", reward: 5, rule: { type: "realViews", n: 1 }, equivalence: "real1" },
  { id: "D32", name: "Mapa curioso", category: "exploration", minLevel: 1, goal: "Consultar fichas de 2 bibliotecas reales distintas", reward: 8, rule: { type: "realViews", n: 2 }, equivalence: "real2" },
  { id: "D33", name: "Conoce el mapa", category: "exploration", minLevel: 1, goal: "Abrir la ficha de una biblioteca distinta de la habitual", reward: 8, rule: { type: "realViews", n: 1, mode: "notHabitual" } },
  { id: "D34", name: "Mira alrededor", category: "exploration", minLevel: 1, goal: "Consultar detalles de 1 biblioteca real", reward: 5, rule: { type: "realViews", n: 1 }, equivalence: "real1" },
  { id: "D35", name: "Tu perfil", category: "exploration", minLevel: 1, goal: "Personalizar nombre visible de tu biblioteca", reward: 5, rule: { type: "nameSaved" } },
  { id: "D36", name: "Primera visita virtual", category: "exploration", minLevel: 1, goal: "Visitar una biblioteca virtual pública", reward: 5, rule: { type: "virtualVisits", n: 1 }, equivalence: "virtual1" },
  { id: "D37", name: "Inspiración vecina", category: "exploration", minLevel: 1, goal: "Visitar 2 bibliotecas virtuales distintas", reward: 8, rule: { type: "virtualVisits", n: 2 } },
  { id: "D38", name: "Arquitectura ajena", category: "exploration", minLevel: 1, goal: "Visitar una biblioteca virtual distinta de la propia", reward: 5, rule: { type: "virtualVisits", n: 1 }, equivalence: "virtual1" },
  { id: "D39", name: "Aplauso decorativo", category: "exploration", minLevel: 1, goal: "Dar me gusta a una biblioteca ajena", reward: 5, rule: { type: "like" } },
  { id: "D40", name: "Colección de ideas", category: "exploration", minLevel: 1, goal: "Visitar 3 bibliotecas virtuales distintas", reward: 12, rule: { type: "virtualVisits", n: 3 } },
  { id: "D41", name: "Ficha nueva", category: "exploration", minLevel: 1, goal: "Consultar una biblioteca real no vista en los últimos 7 días", reward: 8, rule: { type: "realViews", n: 1, mode: "new7d" } },
  { id: "D42", name: "Exploración tranquila", category: "exploration", minLevel: 1, goal: "Consultar 2 fichas reales distintas", reward: 8, rule: { type: "realViews", n: 2 }, equivalence: "real2" },
  { id: "D43", name: "Visita respetuosa", category: "exploration", minLevel: 1, goal: "Visitar una biblioteca virtual y explorar una sala", reward: 8, rule: { type: "virtualVisits", n: 1, room: true } },
  { id: "D44", name: "Vitrina personal", category: "exploration", minLevel: 1, goal: "Colocar o cambiar el trofeo mostrado en vitrina", reward: 5, rule: { type: "showcaseChanged" } },
  { id: "D45", name: "Ajusta tu ambiente", category: "exploration", minLevel: 1, goal: "Guardar preferencia de música o silencio", reward: 5, rule: { type: "musicSaved" } },
];

export const WEEKLY_MISSIONS: MissionDef[] = [
  { id: "W01", name: "Tres días útiles", category: "contribution", minLevel: 1, goal: "Reportar válidamente en 3 días distintos", reward: 30, rule: { type: "reportDays", n: 3 } },
  { id: "W02", name: "Semana informada", category: "contribution", minLevel: 1, goal: "Reportar válidamente en 4 días distintos", reward: 40, rule: { type: "reportDays", n: 4 } },
  { id: "W03", name: "Cinco aportaciones", category: "contribution", minLevel: 1, goal: "5 reportes válidos en la semana, sin requisito diario", reward: 40, rule: { type: "reports", n: 5 } },
  { id: "W04", name: "Un dato por jornada", category: "contribution", minLevel: 1, goal: "2 días distintos con reporte válido", reward: 20, rule: { type: "reportDays", n: 2 } },
  { id: "W05", name: "Constancia creciente", category: "contribution", minLevel: 1, goal: "3 reportes válidos en fechas distintas", reward: 30, rule: { type: "reportDays", n: 3 } },
  { id: "W06", name: "Cuatro datos", category: "contribution", minLevel: 1, goal: "4 reportes válidos, máximo uno cuenta por día", reward: 40, rule: { type: "reportDays", n: 4 } },
  { id: "W07", name: "Reportero de fin de semana", category: "contribution", minLevel: 1, goal: "1 reporte válido sábado o domingo", reward: 20, rule: { type: "reportWeekdays", days: [6, 7] } },
  { id: "W08", name: "La semana empieza bien", category: "contribution", minLevel: 1, goal: "1 reporte válido lunes o martes", reward: 20, rule: { type: "reportWeekdays", days: [1, 2] } },
  { id: "W09", name: "Puente de información", category: "contribution", minLevel: 1, goal: "1 reporte válido en 2 días no consecutivos", reward: 30, rule: { type: "reportNonConsecutive" } },
  { id: "W10", name: "Semana ejemplar", category: "contribution", minLevel: 1, goal: "5 días distintos con reporte válido", reward: 60, rule: { type: "reportDays", n: 5 } },
  { id: "W11", name: "Sala acogedora", category: "decoration", minLevel: 1, goal: "Colocar 5 objetos diferentes en una sala", reward: 20, rule: { type: "roomDistinct", n: 5 } },
  { id: "W12", name: "Interiorista novel", category: "decoration", minLevel: 1, goal: "Guardar 2 diseños distintos en días distintos", reward: 30, rule: { type: "saveDays", n: 2 } },
  { id: "W13", name: "Colección decorativa", category: "decoration", minLevel: 2, goal: "Usar 3 categorías de muebles", reward: 30, rule: { type: "categories", n: 3 } },
  { id: "W14", name: "Jardín de lectura", category: "decoration", minLevel: 2, goal: "Colocar 2 plantas y una lámpara", reward: 30, rule: { type: "plantsLamp" } },
  { id: "W15", name: "Rincón perfecto", category: "decoration", minLevel: 3, goal: "Crear rincón con sillón, estantería y luz", reward: 40, rule: { type: "roomTags", tags: ["armchair", "shelf", "light"], zone: true } },
  { id: "W16", name: "Recepción completa", category: "decoration", minLevel: 4, goal: "Colocar mostrador y señal de bienvenida", reward: 30, rule: { type: "roomTags", tags: ["counter", "welcome"] } },
  { id: "W17", name: "Dos salas con vida", category: "decoration", minLevel: 5, goal: "Decorar 2 salas con 4 objetos cada una", reward: 50, rule: { type: "roomsWithMin", rooms: 2, n: 4 } },
  { id: "W18", name: "Área informática", category: "decoration", minLevel: 7, goal: "Colocar 2 PCs y 2 asientos accesibles", reward: 50, rule: { type: "pcSeats", n: 2 } },
  { id: "W19", name: "Red de información", category: "community", minLevel: 1, goal: "Objetivo global: {n} reportes válidos esta semana", reward: 30, rule: { type: "community", metric: "reports", example: 30 } },
  { id: "W20", name: "La comunidad participa", category: "community", minLevel: 1, goal: "Objetivo global: {n} usuarios distintos con reportes", reward: 30, rule: { type: "community", metric: "users", example: 8 } },
  { id: "W21", name: "Biblioteca compartida", category: "community", minLevel: 1, goal: "Objetivo global: {n} reportes en {library}", reward: 40, rule: { type: "community", metric: "libraryReports", example: 10 } },
  { id: "W22", name: "Semana de ayuda", category: "community", minLevel: 1, goal: "Objetivo global: {n} días-usuario con reporte", reward: 40, rule: { type: "community", metric: "userDays", example: 20 } },
  { id: "W23", name: "Más ojos, mejores datos", category: "community", minLevel: 1, goal: "Objetivo global: {n} bibliotecas distintas con reportes", reward: 50, rule: { type: "community", metric: "libraries", example: 6 } },
  { id: "W24", name: "Reto de barrio", category: "community", minLevel: 1, goal: "Objetivo global: {n} usuarios distintos en {library}", reward: 50, rule: { type: "community", metric: "libraryUsers", example: 5 } },
  { id: "W25", name: "Madrid colabora", category: "community", minLevel: 1, goal: "Objetivo global: {n} reportes válidos", reward: 60, rule: { type: "community", metric: "reports", example: 50 } },
  { id: "W26", name: "Una semana conectada", category: "community", minLevel: 1, goal: "Objetivo global: {n} usuarios activos distintos", reward: 60, rule: { type: "community", metric: "users", example: 15 } },
  { id: "W27", name: "Ruta de bibliotecas", category: "exploration", minLevel: 1, goal: "Consultar fichas de 4 bibliotecas reales distintas", reward: 30, rule: { type: "realViews", n: 4 } },
  { id: "W28", name: "Inspiración colectiva", category: "exploration", minLevel: 1, goal: "Visitar 5 bibliotecas virtuales públicas distintas", reward: 30, rule: { type: "virtualVisits", n: 5 } },
  { id: "W29", name: "Tu evolución", category: "exploration", minLevel: 1, goal: "Subir al menos 1 nivel esta semana", reward: 40, rule: { type: "levelUp" } },
  { id: "W30", name: "Mirada cultural", category: "exploration", minLevel: 1, goal: "Consultar 3 bibliotecas reales y 2 virtuales", reward: 40, rule: { type: "mixedViews", real: 3, virtual: 2 } },
];

export const ALL_MISSIONS = [...DAILY_MISSIONS, ...WEEKLY_MISSIONS];

export function getMission(id: string): MissionDef {
  const def = ALL_MISSIONS.find((m) => m.id === id);
  if (!def) throw new Error(`Misión desconocida: ${id}`);
  return def;
}
