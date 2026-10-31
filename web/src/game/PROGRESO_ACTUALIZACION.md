# Progreso: actualización de «Mi Biblioteca» (checkpoint)

Especificación: `ACTUALIZACION_BIBLIORADAR_PARA_CLAUDE.md` del usuario. Rama local `feature/gamificacion`, sin push.

## Hecho

- **Salas amplias.** Crecen por nivel y con ampliaciones comprables (`roomAt`, `buy_expansion`, `fitPlacements`, migración a esquema 2). Hay tests.
- **Render a doble resolución.**
  - Muebles nuevos con contorno y sombra de contacto.
  - Personajes, bibliotecaria y gato nuevos.
  - Personas dibujadas a escala ×2 (`PERSON_SCALE` en `scene.ts`).
- **Sala de estudio viva.**
  - `sim.ts`: carreras, actividades desincronizadas y prellenado.
  - `study.ts`: material por carrera sobre la mesa.
- **Escena.**
  - `scene.ts` con `RoomView` por sala y una vista general tipo casa de muñecas (botón «Todo»; tocar una sala la abre).
  - Cámara con escala mínima legible en móvil.
- **Editor.**
  - Selección múltiple: «Agrupar» o «Seleccionar varios».
  - Mover o girar un grupo, y guardar todo.
  - Colocación continua desde el inventario, con «Quedan N».
- **Ampliaciones.** Diálogo «Ampliar sala» en la barra del editor, con precio y tamaño máximo.
- **Estudiantes repartidos por sala** en proporción a los asientos.
- **Sonido.**
  - Música y efectos activados por defecto; empiezan tras el primer gesto.
  - Efectos variados (pestaña, seleccionar, comprar, colocar, girar, levantar, guardar, ampliar, nivel, sala nueva, misión, logro).
  - Antirrepetición: los errores, como mucho 1 por segundo.
  - Volumen de efectos propio en Ajustes.
- **Biblioteca pública.**
  - El alias y la publicación se movieron de Ajustes a «Visitar» → «Mi biblioteca pública».
  - Es privada por defecto y publicarla pide confirmación explícita y alias (el motor lo exige).

## Pendiente

1. Revisión visual fina en navegador.
   - La escala ×2 de las personas recién aplicada sin revisar: sentados en sofá o mesa, brazos de escritorio, puerta quizá baja.
   - El gato se dejó a ×1; decidir si se agranda.
2. Inventario: chips de categorías más búsqueda, y unificar los grupos con la tienda.
3. Vitrina ampliada con zoom.
4. Racha con llama en el mapa (`MyLibraryButton`) y panel con racha, récord y protectores.
5. Verificación:
   - Comprobar que `next build`, con y sin flag, no deja chunks del juego.
   - Probar en niveles 1/5/10/15 y en móvil.
   - Informe final.
