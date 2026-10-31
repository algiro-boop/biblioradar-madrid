/** 40 logros permanentes, 5 secretos (§8). La condición se evalúa en el motor con `check`. */

export type AchievementCategory = "Contribución" | "Constancia" | "Decoración" | "Exploración" | "Comunidad" | "Mascotas" | "Cultura";

export type AchievementRule =
  | { type: "reports"; n: number }
  | { type: "streak"; n: number }
  | { type: "perfectWeek" }
  | { type: "protectorEarned" }
  | { type: "placedInstances"; n: number }
  | { type: "placedCategories"; n: number }
  | { type: "roomComplete"; n: number }
  | { type: "roomsWith"; rooms: number; n: number }
  | { type: "floorsWith"; n: number }
  | { type: "ownRarity"; rarity: "R" | "E" | "L"; n: number }
  | { type: "showcase"; n: number }
  | { type: "realLibraries"; n: number }
  | { type: "virtualVisits"; n: number }
  | { type: "communityMissions"; n: number }
  | { type: "catNap" }
  | { type: "vinylCorner" }
  | { type: "quietHour" }
  | { type: "astral"; n: number }
  | { type: "smallExhibition" };

export interface AchievementDef {
  id: string;
  name: string;
  category: AchievementCategory;
  description: string;
  coins: number;
  /** Exclusivo (`X..`) o insignia (`badge:..`) que acompaña a las monedas. */
  reward?: string;
  rewardLabel?: string;
  secret: boolean;
  rule: AchievementRule;
  icon: "flag" | "flame" | "chair" | "gem" | "map" | "users" | "cat" | "disc" | "moon" | "star" | "trophy" | "shield" | "book";
}

const a = (
  id: string, name: string, category: AchievementCategory, description: string, coins: number,
  rule: AchievementRule, icon: AchievementDef["icon"], extra: Partial<AchievementDef> = {},
): AchievementDef => ({ id, name, category, description, coins, rule, icon, secret: false, ...extra });

export const ACHIEVEMENTS: AchievementDef[] = [
  a("A01", "Primera señal", "Contribución", "1 reporte válido acumulado", 10, { type: "reports", n: 1 }, "flag"),
  a("A02", "Manos a la obra", "Contribución", "3 reportes válidos acumulados", 15, { type: "reports", n: 3 }, "flag"),
  a("A03", "Diez datos", "Contribución", "10 reportes válidos acumulados", 20, { type: "reports", n: 10 }, "flag"),
  a("A04", "Contribuidor constante", "Contribución", "25 reportes válidos acumulados", 30, { type: "reports", n: 25 }, "flag"),
  a("A05", "Medio centenar", "Contribución", "50 reportes válidos acumulados", 40, { type: "reports", n: 50 }, "flag"),
  a("A06", "Cien aportaciones", "Contribución", "100 reportes válidos acumulados", 60, { type: "reports", n: 100 }, "flag"),
  a("A07", "Doscientos datos", "Contribución", "200 reportes válidos acumulados", 80, { type: "reports", n: 200 }, "flag"),
  a("A08", "Bibliotecario honorífico", "Contribución", "300 reportes válidos acumulados", 100, { type: "reports", n: 300 }, "book",
    { reward: "badge:honorifico", rewardLabel: "Insignia de bibliotecario honorífico" }),
  a("A09", "Tres días seguidos", "Constancia", "Alcanzar racha de 3 días", 15, { type: "streak", n: 3 }, "flame"),
  a("A10", "Una semana de hábito", "Constancia", "Alcanzar racha de 7 días", 25, { type: "streak", n: 7 }, "flame"),
  a("A11", "Dos semanas", "Constancia", "Alcanzar racha de 14 días", 40, { type: "streak", n: 14 }, "flame"),
  a("A12", "Mes de constancia", "Constancia", "Alcanzar racha de 30 días", 60, { type: "streak", n: 30 }, "flame",
    { reward: "frame:oro", rewardLabel: "Marco de vitrina dorado" }),
  a("A13", "Sesenta días", "Constancia", "Alcanzar racha de 60 días", 80, { type: "streak", n: 60 }, "flame"),
  a("A14", "Cien días", "Constancia", "Alcanzar racha de 100 días", 100, { type: "streak", n: 100 }, "trophy",
    { reward: "X11", rewardLabel: "Trofeo de constancia" }),
  a("A15", "Semana impecable", "Constancia", "Completar una semana natural con 7 días reportados", 35, { type: "perfectWeek" }, "star"),
  a("A16", "Protector prudente", "Constancia", "Obtener 1 protector por semana completa", 20, { type: "protectorEarned" }, "shield"),
  a("A17", "Primer mueble", "Decoración", "Colocar 1 mueble", 10, { type: "placedInstances", n: 1 }, "chair"),
  a("A18", "Decorador en marcha", "Decoración", "Colocar 10 instancias diferentes", 20, { type: "placedInstances", n: 10 }, "chair"),
  a("A19", "Variedad creativa", "Decoración", "Colocar muebles de 5 categorías", 25, { type: "placedCategories", n: 5 }, "chair"),
  a("A20", "Primera sala terminada", "Decoración", "Colocar 12 muebles sin bloquear accesos", 30, { type: "roomComplete", n: 12 }, "chair"),
  a("A21", "Segunda sala viva", "Decoración", "Decorar 2 salas con 5 objetos cada una", 40, { type: "roomsWith", rooms: 2, n: 5 }, "chair"),
  a("A22", "Diseño de altura", "Decoración", "Decorar ambas plantas con 5 objetos por planta", 50, { type: "floorsWith", n: 5 }, "chair"),
  a("A23", "Coleccionista raro", "Decoración", "Poseer 5 especiales raros distintos", 40, { type: "ownRarity", rarity: "R", n: 5 }, "gem"),
  a("A24", "Coleccionista épico", "Decoración", "Poseer 3 especiales épicos distintos", 60, { type: "ownRarity", rarity: "E", n: 3 }, "gem"),
  a("A25", "Cinco leyendas", "Decoración", "Poseer 5 especiales legendarios distintos", 80, { type: "ownRarity", rarity: "L", n: 5 }, "gem",
    { reward: "X12", rewardLabel: "Copa legendaria" }),
  a("A26", "Vitrina brillante", "Decoración", "Exhibir 3 logros en vitrina", 20, { type: "showcase", n: 3 }, "trophy"),
  a("A27", "Cartógrafo novel", "Exploración", "Consultar 5 bibliotecas reales distintas", 15, { type: "realLibraries", n: 5 }, "map"),
  a("A28", "Mapa abierto", "Exploración", "Consultar 10 bibliotecas reales distintas", 25, { type: "realLibraries", n: 10 }, "map"),
  a("A29", "Curioso de Madrid", "Exploración", "Consultar 20 bibliotecas reales distintas", 40, { type: "realLibraries", n: 20 }, "map"),
  a("A30", "Primera visita ajena", "Exploración", "Visitar 1 biblioteca virtual pública ajena", 10, { type: "virtualVisits", n: 1 }, "map"),
  a("A31", "Turista virtual", "Exploración", "Visitar 10 bibliotecas virtuales distintas", 25, { type: "virtualVisits", n: 10 }, "map"),
  a("A32", "Ruta de inspiración", "Exploración", "Visitar 20 bibliotecas virtuales distintas", 40, { type: "virtualVisits", n: 20 }, "map"),
  a("A33", "Mano amiga", "Comunidad", "Contribuir a 1 misión comunitaria completada", 20, { type: "communityMissions", n: 1 }, "users"),
  a("A34", "Equipo de lectura", "Comunidad", "Contribuir a 3 misiones comunitarias completadas", 30, { type: "communityMissions", n: 3 }, "users"),
  a("A35", "Red de bibliotecas", "Comunidad", "Contribuir a 10 misiones comunitarias completadas", 60, { type: "communityMissions", n: 10 }, "users"),
  a("A36", "El gato te eligió", "Mascotas", "Presenciar la primera siesta del gato", 25, { type: "catNap" }, "cat",
    { secret: true, reward: "X13", rewardLabel: "Figura de gato" }),
  a("A37", "Amante del vinilo", "Decoración", "Tocadiscos y caja de vinilos en la misma sala", 25, { type: "vinylCorner" }, "disc",
    { secret: true, reward: "X14", rewardLabel: "Póster de vinilo" }),
  a("A38", "La hora tranquila", "Decoración", "Guardar una sala con rincón lector, lámpara y planta", 25, { type: "quietHour" }, "book",
    { secret: true, reward: "X15", rewardLabel: "Lámpara de la hora tranquila" }),
  a("A39", "Biblioteca bajo las estrellas", "Decoración", "Colocar 3 objetos astrales distintos", 35, { type: "astral", n: 3 }, "moon",
    { secret: true, reward: "frame:estelar", rewardLabel: "Marco de vitrina estelar" }),
  a("A40", "Pequeña exposición", "Cultura", "Exhibir 3 logros y colocar una vitrina cultural", 35, { type: "smallExhibition" }, "star",
    { secret: true, reward: "X16", rewardLabel: "Placa de la pequeña exposición" }),
];

export function getAchievement(id: string): AchievementDef {
  const def = ACHIEVEMENTS.find((x) => x.id === id);
  if (!def) throw new Error(`Logro desconocido: ${id}`);
  return def;
}
