/**
 * Bibliotecas de muestra: escaparates montados a mano con piezas del catálogo para enseñar lo que
 * se puede construir en Mi Biblioteca. Se visitan como cualquier otra biblioteca (solo mirar).
 * Convenciones de giro: estanterías y muebles con frente, 0 mira a +y (contra la pared derecha) y
 * 1 a +x (contra la izquierda); sillas, 0 a +x, 1 a +y, 2 a −x y 3 a −y; sofás, 0 a +y, 1 a +x.
 */

import type { NeighborLibrary, NeighborPlacement } from "./neighbors";

type Row = [itemId: string, x: number, y: number, rot?: number];
const at = (room: string, rows: Row[]): NeighborPlacement[] => rows.map(([itemId, x, y, rot = 0]) => ({ itemId, room, x, y, rot }));

const ALIAS = "Equipo BiblioRadar";

export const SHOWCASES: NeighborLibrary[] = [
  {
    id: "muestra-vinilo", alias: ALIAS, libraryName: "Café Vinilo", level: 12, rooms: ["r1"],
    blurb: "Ladrillo visto, jazz en el tocadiscos y mesitas de café para leer sin prisa.",
    styles: { r1: { floor: "floor-nogal", wall: "wall-ladrillo", window: "window-madera" } },
    placements: at("r1", [
      // Barra con la estantería detrás.
      ["R021", 0, 0], ["P087", 2, 0], ["R022", 3, 0], ["P023", 4, 0], ["P068", 6, 0], ["P088", 7, 0], ["P021", 9, 0], ["P090", 11, 0],
      ["P061", 4, 2], ["R024", 5, 2], ["P057", 4, 2], ["P041", 6, 2], ["E018", 9, 0], ["P026", 10, 0],
      ["P044", 0, 0, 0], ["P044", 4, 0, 0], ["X14", 7, 0, 0], ["P047", 8, 0, 0], ["P044", 11, 0, 0],
      // Sofás contra la pared izquierda.
      ["R023", 0, 2, 1], ["P084", 2, 2, 1], ["P043", 0, 5], ["P082", 0, 7, 1], ["P084", 2, 8, 1], ["P085", 3, 8], ["P034", 0, 10], ["P031", 0, 11],
      ["P050", 2, 0, 1], ["P045", 5, 0, 1], ["P046", 8, 0, 1], ["P060", 10, 0, 1],
      ["R022", 2, 2], ["P056", 2, 9],
      // Mesitas de café.
      ["P052", 6, 5], ["P002", 6, 5], ["R005", 5, 5, 0], ["R005", 8, 6, 2], ["R005", 6, 4, 1], ["R005", 7, 7, 3], ["P041", 6, 5], ["P025", 7, 6],
      ["P002", 10, 4], ["R005", 9, 4, 0], ["R005", 12, 5, 2], ["R005", 11, 3, 1], ["R005", 10, 6, 3], ["R016", 10, 4],
      ["P002", 9, 9], ["R005", 8, 9, 0], ["R005", 11, 10, 2], ["R005", 9, 8, 1], ["R005", 10, 11, 3], ["P026", 9, 9],
      ["R002", 4, 10], ["R005", 3, 11, 0], ["R005", 7, 11, 2], ["P056", 5, 10],
      ["P033", 12, 8], ["P043", 12, 7], ["P063", 1, 5],
    ]),
  },
  {
    id: "muestra-infinita", alias: ALIAS, libraryName: "La Biblioteca Infinita", level: 15, rooms: ["r1", "r2", "r3", "r4"],
    blurb: "Cuatro salas en dos plantas: sala de estudio clásica, salón de lectura, archivo y un gran salón de museo.",
    styles: {
      r1: { floor: "floor-mosaico", wall: "wall-verde-ingles", window: "window-vidriera" },
      r2: { floor: "floor-moqueta-burdeos", wall: "wall-madera", window: "window-madera" },
      r3: { floor: "floor-nogal", wall: "wall-burdeos", window: "window-vidriera" },
      r4: { floor: "floor-marmol", wall: "wall-dorado", window: "window-arco" },
    },
    placements: [
      ...at("r1", [
        ["P022", 0, 0], ["P021", 2, 0], ["P030", 4, 0], ["P049", 8, 0], ["P021", 9, 0], ["P028", 11, 0],
        ["P048", 8, 0, 0], ["P045", 1, 0, 0],
        ["P028", 0, 2, 1], ["P049", 0, 5], ["P030", 0, 7, 1], ["P022", 0, 11, 1],
        ["P045", 5, 0, 1], ["P050", 2, 0, 1],
        // Dos mesas largas de sala de estudio con flexos verdes.
        ["P007", 4, 3], ["R006", 4, 2, 1], ["R006", 5, 2, 1], ["R006", 6, 2, 1], ["R006", 7, 2, 1],
        ["R006", 4, 5, 3], ["R006", 5, 5, 3], ["R006", 6, 5, 3], ["R006", 7, 5, 3],
        ["P042", 4, 3], ["P042", 6, 3], ["P042", 5, 4], ["P042", 7, 4],
        ["P007", 4, 8], ["R006", 4, 7, 1], ["R006", 5, 7, 1], ["R006", 6, 7, 1], ["R006", 7, 7, 1],
        ["R006", 4, 10, 3], ["R006", 5, 10, 3], ["R006", 6, 10, 3], ["R006", 7, 10, 3],
        ["P042", 4, 8], ["P042", 6, 8], ["P042", 5, 9], ["P042", 7, 9],
        // Mesa gótica.
        ["E003", 10, 3], ["R006", 10, 2, 1], ["R006", 12, 2, 1], ["R006", 10, 5, 3], ["R006", 12, 5, 3], ["R006", 9, 4, 0],
        ["P055", 11, 3], ["R017", 12, 4], ["R012", 10, 4],
        // Rincón de orejeros.
        ["P051", 10, 9], ["P084", 10, 9], ["P083", 12, 9, 2], ["P083", 9, 11, 3], ["P043", 13, 12], ["P034", 13, 7], ["E011", 10, 9],
      ]),
      ...at("r2", [
        ["P033", 0, 0], ["P021", 1, 0], ["P022", 3, 0], ["P036", 5, 0], ["P090", 7, 0], ["P043", 9, 0], ["P021", 10, 0], ["P034", 12, 0],
        ["P048", 3, 0, 0], ["P050", 7, 0, 0], ["P045", 9, 0, 0], ["P046", 12, 0, 0],
        ["P028", 0, 1, 1], ["P049", 0, 4], ["P028", 0, 7, 1], ["P038", 0, 10],
        ["P045", 4, 0, 1], ["P050", 7, 0, 1],
        // Salita con dos sofás frente a frente.
        ["P053", 4, 6], ["R023", 4, 4, 0], ["P084", 4, 6], ["P085", 6, 6], ["P082", 4, 7, 2], ["P083", 7, 5, 2], ["P083", 2, 5, 0],
        ["E011", 4, 6], ["P041", 5, 6],
        // Mesa de lectura vintage.
        ["P009", 10, 4], ["R006", 9, 4, 0], ["R006", 12, 5, 2], ["R006", 10, 3, 1], ["R006", 11, 6, 3], ["P042", 11, 5],
        ["P019", 10, 8, 2], ["P043", 12, 8], ["P031", 12, 11], ["P027", 8, 10], ["P085", 2, 11], ["P054", 3, 11],
      ]),
      ...at("r3", [
        ["P068", 0, 0], ["P021", 1, 0], ["E010", 3, 0], ["P068", 5, 0], ["P021", 6, 0], ["E009", 8, 0], ["P036", 10, 0], ["P033", 12, 0],
        ["P048", 5, 0, 0], ["P046", 9, 0, 0], ["P046", 12, 0, 0],
        ["P028", 0, 1, 1], ["P043", 0, 4], ["P028", 0, 7, 1], ["P034", 0, 10],
        ["P045", 4, 0, 1], ["P050", 8, 0, 1],
        // Puestos de trabajo.
        ["P072", 4, 3], ["P016", 4, 5, 3], ["P071", 4, 3], ["P077", 5, 3],
        ["P072", 7, 3], ["P016", 7, 5, 3], ["P073", 7, 3], ["P042", 8, 3],
        ["P072", 10, 3], ["P016", 10, 5, 3], ["P071", 10, 3], ["P074", 11, 4],
        // Piano de luz y mesa de mapas.
        ["L014", 3, 8], ["R008", 3, 9, 3],
        ["P052", 7, 7], ["R004", 7, 7], ["R006", 7, 6, 1], ["R006", 9, 6, 1], ["R006", 7, 9, 3], ["R006", 9, 9, 3], ["R006", 10, 8, 2],
        ["R020", 8, 7], ["P056", 9, 8],
        ["P043", 12, 9], ["P031", 12, 10],
      ]),
      ...at("r4", [
        ["P038", 0, 0], ["P049", 3, 0], ["P070", 4, 0], ["P049", 6, 0], ["P089", 7, 0], ["E009", 9, 0], ["E020", 11, 0], ["P049", 13, 0], ["X01", 14, 0],
        ["P045", 3, 0, 0], ["P045", 6, 0, 0], ["P050", 9, 0, 0], ["E015", 13, 0, 0],
        ["P030", 0, 2, 1], ["P049", 0, 6], ["P030", 0, 9, 1], ["P034", 0, 13],
        ["P045", 6, 0, 1], ["P045", 8, 0, 1], ["X16", 13, 0, 1],
        // Estatua central con bancos alrededor.
        ["X07", 7, 6], ["R008", 5, 7, 0], ["R008", 10, 6, 2], ["R008", 8, 4, 1], ["R008", 7, 9, 3],
        ["E016", 6, 5], ["E016", 9, 5], ["E016", 6, 8], ["E016", 9, 8],
        // Mesas de mapas y gótica.
        ["R004", 3, 3], ["R006", 3, 2, 1], ["R006", 5, 2, 1], ["R006", 3, 5, 3], ["R006", 5, 5, 3], ["R020", 4, 3], ["P042", 5, 4],
        ["E003", 11, 3], ["R006", 11, 2, 1], ["R006", 13, 2, 1], ["R006", 11, 5, 3], ["R006", 13, 5, 3], ["X13", 12, 3], ["X12", 13, 4], ["P041", 11, 4],
        // Monumento, fuente y piano.
        ["L016", 3, 10], ["X06", 12, 9], ["P090", 14, 6, 0], ["R008", 14, 8, 3],
        // Salita.
        ["P051", 9, 10], ["P084", 9, 10], ["E007", 9, 12, 2], ["P083", 7, 10, 0], ["E011", 9, 10],
        ["P038", 1, 11], ["E013", 6, 13], ["L009", 15, 10], ["P043", 15, 4],
        // Mesa larga de consulta y banco frente al monumento.
        ["P006", 12, 12], ["R006", 15, 13, 2], ["P042", 12, 12], ["P042", 14, 13], ["R012", 13, 12],
        ["P051", 3, 12], ["R008", 4, 12, 3],
      ]),
    ],
  },
];
