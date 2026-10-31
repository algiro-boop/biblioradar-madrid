# Progreso: actualización de «Mi Biblioteca»

Especificación: `ACTUALIZACION_BIBLIORADAR_PARA_CLAUDE.md` del usuario. Rama local `feature/gamificacion`, sin push.

## Hecho

- **Salas amplias.** Crecen por nivel y con ampliaciones comprables (`roomAt`, `buy_expansion`, `fitPlacements`, migración a esquema 2). Hay tests.
- **Render a doble resolución.**
  - Muebles nuevos con contorno y sombra de contacto.
  - Personajes, bibliotecaria y gato nuevos.
  - Personas a escala ×2 (`PERSON_SCALE` en `scene.ts`).
  - Postura sentada con regazo y espinillas.
- **Sala de estudio viva.**
  - `sim.ts`: carreras, actividades desincronizadas y prellenado.
  - `study.ts`: material por carrera sobre la mesa.
- **Vista general tipo casa de muñecas.**
  - Botón «Vista general» abajo a la izquierda, desde el nivel 1.
  - Cada planta es un edificio continuo y la planta alta va separada encima.
  - Las salas aún bloqueadas se ven en fantasma con «🔒 nivel N».
  - Tiene rótulos de sala y planta, zoom y desplazamiento, y tocar una sala la abre.
  - Queda centrada en móvil.
- **Editor.**
  - Selección múltiple: «Agrupar» o «Seleccionar varios».
  - Mover o girar un grupo, y guardar todo.
  - Colocación continua desde el inventario, con «Quedan N» (cuenta solo las unidades no vendidas).
- **Ampliaciones.** Diálogo «Ampliar sala» en la barra del editor, con precio y tamaño máximo.
- **Estudiantes repartidos por sala** en proporción a los asientos.
- **Inventario y tienda.** Chips de categoría (`ITEM_CATEGORIES`) con recuento y un buscador que ignora tildes. El inventario tiene además «Solo guardados».
- **Vitrina ampliada** (`ShowcaseViewer.tsx`).
  - Pantalla completa con baldas y marco.
  - Zoom del 100 al 300 % con botones, +/−, Ctrl + rueda o pellizco.
  - Galería de todos los logros, con exponer o quitar.
- **Racha en el mapa** (`MyLibraryButton.tsx`). Llama pixel art animada que respeta el movimiento reducido; al tocarla, un panel muestra la racha, el récord y los protectores.
- **Sonido.**
  - Música y efectos activados por defecto; empiezan tras el primer gesto.
  - Efectos variados y antirrepetición.
  - Volumen de efectos propio en Ajustes.
- **Biblioteca pública.**
  - El alias y la publicación se movieron a «Visitar» → «Mi biblioteca pública».
  - Es privada por defecto; publicarla pide confirmación y alias.

## Verificado

- `tsc` limpio y 301/301 tests de vitest.
- `next build` con el flag a 0: no hay ruta `/mi-biblioteca` y ningún chunk de `.next/static` contiene textos del juego.
- `next build` con el flag: incluye `/mi-biblioteca`.
- Navegador (panel de escritorio y móvil emulado de 375×812), con niveles 1, 5, 10 y 15:
  - vista de sala y vista general;
  - colocación continua y movimiento en grupo;
  - filtros del inventario;
  - vitrina con zoom;
  - racha en el mapa.

## Limitaciones conocidas

- El gato sigue a escala ×1.
- Las posturas sentadas son sencillas.
- La tienda filtra por las categorías nuevas (`itemCategory`); misiones y logros siguen contando las de `shopGroup`, sin cambios de lógica.
- El sonido no se ha comprobado de oído; solo que el contexto de audio se desbloquea con el primer gesto.
- El pellizco de la vitrina y el táctil no se han probado en un móvil real, solo emulado.
- En móvil, el borde derecho de la vista general puede quedar bajo los botones de zoom con algunas combinaciones de salas.
