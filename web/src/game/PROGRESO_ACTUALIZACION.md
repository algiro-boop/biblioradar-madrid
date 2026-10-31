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

### Ronda de arreglos tras probar en el móvil

- **Giro en 4 direcciones.** Todo lo de suelo gira 0/90/180/270° (`rotationsFor`); lo colgado elige pared. Cada mueble asimétrico dibuja su parte trasera a 180° y 270° (`paintItem`, `alongX`, `flip`). La IA de lectores y mostrador usa `FRONT`/`TOWARD` para cualquier giro.
- **Orden de dibujo.** `paintOrder` ordena por huella (orden topológico) en vez de por la suma del centro, así un mueble ya no tapa a otro que está delante. Lo que va encima de una mesa comparte la caja de la mesa.
- **Remate de las paredes.** Era un polígono no convexo y `poly` solo rellena convexos; pintaba un triángulo sobre las paredes de todas las salas (el «ladrillo solo en los bordes» de El Atril). Ahora son dos cuadriláteros.
- **Móvil.** Miniaturas de la tienda que pisaban el nombre (iOS), botón del mapa y racha encima del selector Mapa/Lista, pestañas que no cabían a 375 px y la etiqueta de planta repetida («1.ª planta» / «Planta baja»). La página lleva `notranslate` para que la barra de traducir de Chrome no la desplace.
- **Pared y suelo en la tienda.** 21 acabados a la venta, de nivel 2 a nivel 15 (`STYLES` con `price`), con dibujos propios: parquet, espiga, moqueta, cuadros, hidráulica, mármol, pizarra, mosaico, ladrillo, topos, rayas, friso de madera, azulejo y damasco. Se compran una vez (`buy_style`, `ownedStyles`, esquema 3) y se aplican en Decorar → Acabados, que ya está disponible desde el nivel 1.

### Bibliotecas de muestra y modo foto

- **Inspiración** (`data/showcases.ts`, sección en «Visitar»): 6 bibliotecas montadas a mano para enseñar lo que se puede hacer: Jardín de Invierno (2 salas), Café Vinilo, Observatorio de Medianoche, La Biblioteca Infinita (4 salas en 2 plantas), Estudio Nórdico (2 salas) y Nube de Algodón. Se visitan como las demás (solo mirar) y entran en `NEIGHBORS`.
- **Vista general de visita**: «Todo» en el banner de visita y botón «Vista general» cuando la biblioteca visitada tiene varias salas; tocar una sala entra en ella.
- **Modo foto**: botón de cámara junto al zoom; oculta menús, banners y botones para hacer capturas limpias. Se sale con la × o con Esc.
- **Zoom en móvil**: los botones pasan a una pastilla horizontal en la esquina inferior derecha y se ocultan mientras está abierta la barra del editor.
- **Sofás**: se dibujaban «de lado» (respaldo en el lado corto) y los lectores se sentaban en la punta. `seatFacing` hace que los asientos alargados miren por su lado largo; las sillas de una casilla no cambian.
- Banner de visita compacto en móvil (botones en una fila desplazable) y `Button` transmite `aria-pressed`.
- **Aviso de hidratación en el iPhone** (Chrome para iOS): el navegador añade `__gcruniqueid` a los campos de formulario antes de que React hidrate (buscador del mapa y formulario de sugerencias). Esos campos llevan `suppressHydrationWarning`; no era un fallo de la app y en producción no se mostraba.

### Revisión en el simulador de iOS (Safari, iPhone 17 Pro Max)

- La tarjeta «Un solar vacío… por ahora» tapaba la pastilla de zoom en móvil: ahora queda por encima (`max-sm:bottom-16`).
- **Cabecera del mapa (código de la app pública)**: entre ~430 y 440 px de ancho, «Instalar app» se salía por la derecha porque el hijo de `Reveal` (un grid) conservaba `min-width: auto` y el título no podía encoger. Con `min-w-0` cabe en 375, 393, 430 y 440 px. Este cambio afecta a la app pública cuando se publique la rama.
- **Racha en el mapa**: se ocultaba en nivel 0 con 0 días, así que una partida nueva no la veía. Ahora se muestra siempre (llama apagada y «0» hasta el primer reporte), como pide la especificación.

### Luz real de Madrid y tutorial

- **Ciclo de luz** (`game/sun.ts`): la altura del sol sobre Madrid se calcula para cada instante (fórmulas del Almanaque Náutico; salida y puesta con ±2 min respecto al OAN, cambios de hora incluidos). La sala pasa por noche, amanecer, día y atardecer a la vez que la ciudad. El cielo de las ventanas va en degradado del horizonte al cénit, con el sol bajo al amanecer y al atardecer, y con luna y estrellas de noche. Sobre la sala caen dos velos: una penumbra y un brillo rosado al alba o naranja al atardecer. Con el sol bajo, el haz de luz del suelo se alarga y se vuelve dorado. El cielo se repinta cada 5 minutos.
- En Dev, «Luz del día» enseña las horas de hoy y deja ver amanecer, día, atardecer o noche sin mover el reloj del juego (que afectaría a rachas y misiones).
- **Tutorial** (`components/game/Tutorial.tsx`): 10 pasos breves (reportes y niveles, monedas, racha, misiones, tienda, inventario y decorar, logros y progreso, visitar y ajustes, luz de Madrid). Cada paso ilumina su pestaña y las cifras salen del motor. Sale una sola vez por navegador: se marca al mostrarse, así que no se repite aunque se cierre a medias. Se puede volver a ver desde Ajustes → Ayuda. Espera a que no haya ninguna celebración en pantalla.

### Nuevo logo (afecta a la app pública cuando se publique la rama)

- El logo pixel art (`scripts/brand/logo.webp`) sustituye al radar vectorial. `npm run icons` genera desde él:
  - con el logo completo a sangre: el icono de iOS (180), los de la PWA (192 y 512 con esquinas redondeadas) y el maskable de Android (el nombre cabe en el círculo del 80 %);
  - con la escena sin el nombre (las letras no se leen a 16–48 px): el favicon y `icon-mark.png`, usado en la cabecera, en el diálogo de instalación y en sus maquetas.
- `icon.svg` se elimina. `ICON_VERSION` pasa a 3 y el service worker a `v4`, para que iOS y Android no sigan mostrando los iconos viejos.
- Se quita el barrido verde que giraba sobre el logo de la cabecera (pensado para el radar): el estado «en vivo» ya lo indica el punto verde.

### Anuncio vertical (TikTok / Reels)

- **`npm run ad`** (con `npm run dev` y el flag en marcha) graba un MP4 de 41 s, 1080×1920 a 30 fps, en `web/anuncio/biblioradar-anuncio.mp4` con portada en `anuncio/portada.jpg`. La carpeta no se versiona.
- Lo dibuja el propio motor (`game/ad/promo.ts`) desde la ruta de desarrollo `/mi-biblioteca/anuncio`, que da 404 sin `next dev` y sin el flag. Con `?preview` se reproduce en el navegador.
  - `scripts/ad/record.mjs` pide los fotogramas en orden a Chromium sin ventana (Playwright).
  - `soundtrack.mjs` sintetiza la música, un chiptune propio a 120 ppm, y los efectos sincronizados.
  - `encode.swift` (AVFoundation) lo une en H.264 + AAC, sin ffmpeg.
  - `Scene.step(dt)` avanza la escena sin su bucle.
- **Guion:**

  | Tiempo | Plano |
  | --- | --- |
  | 0–3 s | Gancho «¿Llegas a la biblio… y está LLENA?» con sello 100 %. |
  | 3–9 s | Mapa con aforo en vivo y ficha de una biblioteca («105 bibliotecas»). |
  | 9–13 s | Reporte en 2 toques y +10 monedas. |
  | 13–23 s | Del solar al nivel 15, con las cinemáticas del juego. |
  | 23–31 s | Racha, tienda, misiones y logros, y visitas. |
  | 31–35 s | Luz de Madrid de amanecer a noche. |
  | 35–41 s | Logo y «¡Pruébala gratis!». |

- Los porcentajes del mapa son ilustrativos (lo dice el propio plano). El anuncio enseña Mi Biblioteca, que aún no es pública: no se debería difundir hasta publicarla.

### Publicación

- El juego queda **activo por defecto**. Para apagarlo sin tocar código, se pone `NEXT_PUBLIC_GAMIFICATION=0` en Vercel y se hace un nuevo despliegue (comprobado: sin ruta y sin ningún fichero del juego en el build).
- Ajustes para el público:
  - Las vecinas son «Bibliotecas de ejemplo» inventadas, sin alias de personas en el banner de visita.
  - «Mi biblioteca pública» aparece como «Próximamente»: no hay servidor que la enseñe a nadie.
  - Las misiones comunitarias no se asignan, porque su progreso global solo existía simulado. Se activan con `NEXT_PUBLIC_GAME_COMMUNITY=1`, y sus logros salen como «Próximamente».
- **Sugerencias en el mapa móvil**: el botón se había perdido al compactar la cabecera. Vuelve como icono junto al buscador.
  - Como ahora hay dos instancias del formulario, sus `id` se generan con `useId`.
  - En la fila superior no cabía: a 375–393 px cortaba «BiblioRadar».

## Verificado

- `tsc` limpio y 308/308 tests de vitest (incluye que las bibliotecas de muestra son válidas en su nivel, solo usan muebles de su nivel y no dejan casillas inaccesibles).
- `next build` con el flag a 0: no hay ruta `/mi-biblioteca` y ningún chunk de `.next/static` contiene textos del juego.
- `next build` con el flag: incluye `/mi-biblioteca` (repetido tras las bibliotecas de muestra; sin el flag sigue sin ruta ni textos del juego).
- Navegador (panel de escritorio y móvil emulado de 375×812), con niveles 1, 5, 10 y 15:
  - vista de sala y vista general;
  - colocación continua y movimiento en grupo;
  - filtros del inventario;
  - vitrina con zoom;
  - racha en el mapa;
  - hoja de sprites con 22 muebles asimétricos en los 4 giros;
  - compra de un suelo, aplicación en una sala y guardado; vista general y El Atril tras arreglar el remate;
  - las 6 bibliotecas de muestra en móvil emulado, la vista general de visita y el modo foto.
- Simulador de iOS (Safari, modo claro y oscuro): mapa, Mi Biblioteca en nivel 0, panel «Visitar» con Inspiración, visita a una muestra de una sala y a otra de dos (chips, «Vista general», zoom), aviso de logro y modo foto.

## Limitaciones conocidas

- El gato sigue a escala ×1.
- Las posturas sentadas son sencillas.
- La tienda filtra por las categorías nuevas (`itemCategory`); misiones y logros siguen contando las de `shopGroup`, sin cambios de lógica.
- El sonido no se ha comprobado de oído; solo que el contexto de audio se desbloquea con el primer gesto.
- El pellizco de la vitrina y el táctil no se han probado en un móvil real, solo emulado.
- En móvil, el borde derecho de la vista general puede quedar bajo los botones de zoom con algunas combinaciones de salas.
- Los arreglos de esta ronda no se han vuelto a probar en un móvil real, solo emulado; el efecto de `notranslate` está sin confirmar.
- Las vistas traseras de los muebles son sencillas (tablero o panel liso).
- Las bibliotecas de muestra son datos locales del entorno de pruebas, como las vecinas ficticias; no hay galería de capturas generada, se hacen con el modo foto.
