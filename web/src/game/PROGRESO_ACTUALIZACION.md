# Progreso: actualización de «Mi Biblioteca» (checkpoint)

Especificación: `ACTUALIZACION_BIBLIORADAR_PARA_CLAUDE.md` del usuario. Rama local `feature/gamificacion`, sin push.

## Hecho

- **Salas amplias.** `data/levels.ts` define `RoomSpec`, con `sizes` por nivel y `expansions` (precios). `roomAt(id, nivel, compradas)` devuelve la sala efectiva y `roomMax` el máximo en L15.
  - Las salas crecen solo hacia +x/+y.
  - Las ventanas futuras reservan sus huecos.
- **Motor.**
  - Nuevos campos: `expansions`, comando `buy_expansion` y `migrateState` (esquema 2: sonido activado y `sfxVolume`).
  - `fitPlacements` lleva al inventario lo que ya no cabe y avisa con la celebración `relocated`.
  - Celebraciones `expansion` al crecer.
  - Hay tests nuevos y pasan 42.
- **Render a doble resolución.** En `pixel.ts`: `ZS=2`, TW=64/TH=32, z en unidades × ZS, `ball()`, `px()` y `outlineCanvas()`.
- **Muebles nuevos.** En `furniture.ts`, con `oriented()` + `drawParts()`: sofás y sillones, sillas, silla de oficina, taburete, mesas, escritorios, estanterías con libros variados, lámparas, flexos y lámparas de pie.
- **Personajes nuevos.** En `characters.ts`:
  - Rostro, 7 peinados, 8 prendas y carreras.
  - Bibliotecaria con rebeca, acreditación y libros.
  - Gato con poses walk/sit/sleep/groom/stretch/jump.
  - `drawDeskArms`.
- **Material de estudio.** `study.ts` dibuja el material por carrera sobre la mesa.

## Pendiente (en orden)

1. Reescribir `render/sim.ts`:
   - Carreras y kit por estudiante.
   - Actividades con temporizadores desincronizados.
   - `spot.desk`, `spot.at` y profundidad respecto al mueble.
   - Prellenado de asientos y nuevos valores de `SEAT_Z`.
2. Reescribir `render/scene.ts`:
   - `RoomView` por sala y modo vista general (casa de muñecas).
   - Escalas ×ZS en partículas, halos, selección y `pick`.
   - Zoom mínimo en móvil.
   - Contorno y sombra en `furnitureSprite` (`oy` ≈ 150).
   - Selección múltiple y varios fantasmas.
3. `GameStage`/`LibraryGame`:
   - Botón de vista general, compra de ampliaciones y estudiantes por sala.
   - Ajustar la API nueva de `drawPerson`/`drawCat`.
4. Sonido: activado por defecto, desbloqueo en el primer gesto, efectos nuevos con antirrepetición y volumen de efectos.
5. Inventario: filtros y búsqueda, colocación continua y selección y movimiento en grupo.
6. Resto:
   - Vitrina ampliada con zoom.
   - Racha (llama) en el mapa, dentro de `MyLibraryButton`.
   - Mover alias y publicación a «Visitar» → «Mi biblioteca pública».
7. Verificación:
   - `tsc`, tests y `next build` con y sin flag (0 chunks del juego).
   - Navegador en niveles 1/5/10/15 y en móvil.
   - Informe final.
