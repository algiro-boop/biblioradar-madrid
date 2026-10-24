# BiblioRadar Madrid · Fases 1 y 2

Base de datos Supabase y catálogo de bibliotecas municipales. Python 3.11+, entorno y dependencias con `uv`. La Fase 2 añade motor híbrido, conectores, fusión transaccional y cron. El frontend de la Fase 3 sigue pendiente.

## Arquitectura prevista

1. Catálogo oficial → limpieza en Python → Supabase (`libraries`).
2. Google/UCM + clima y calendario + reportes con decaimiento → `occupancy_status` (Fase 2).
3. Fase 3: Next.js, Tailwind, React-Leaflet y PWA; lectura pública y Realtime del estado; reportes por RPC.

`libraries` tiene un UUID interno estable y una clave única `(source, source_id)` para importar repetidamente sin duplicar. Cada alta crea automáticamente su fila en `occupancy_status`. La ingesta no modifica ocupaciones, `google_place_id` ni `total_seats` existentes.

**Estado inicial:** los porcentajes y la etiqueta son `NULL` hasta disponer de una medición o estimación. Es una extensión deliberada del esquema solicitado para no representar la ausencia de datos como “0 %, libre”. El frontend deberá representar este estado como desconocido. Las etiquetas se calculan automáticamente: `free` < 70, `moderate` 70–89, `high` 90–99 y `full` 100. Los pines de los dos últimos estados serán rojos.

## 1. Crear la base de datos

Crea un proyecto Supabase. Abre SQL Editor y ejecuta el contenido completo de:

`supabase/migrations/202610230001_phase1.sql`

La migración está pensada para ejecutarse **una sola vez sobre un proyecto nuevo**, como `postgres`; usa una transacción y no borra tablas. Con Supabase CLI también se puede aplicar mediante `supabase link --project-ref TU_REFERENCIA` y `supabase db push`. No mezcles la aplicación manual y por CLI sin reconciliar el historial de migraciones.

Incluye tablas, enums, índices, restricciones, triggers, RPC, RLS y publicación Realtime de `occupancy_status`. No requiere PostGIS ni un backend permanente.

## 2. Preparar el entorno

```sh
uv sync --locked
cp .env.example .env
```

Edita `.env`:

```dotenv
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_CLAVE_SERVICE_ROLE
```

Usa la clave **service_role** del servidor, nunca la clave pública ni una variable `NEXT_PUBLIC_*`. El archivo `.env` está ignorado por Git. El script no imprime la clave ni cuerpos de errores remotos.

## 3. Validar e importar

Primero revisa sin necesidad de credenciales:

```sh
uv run biblioradar-ingest --dry-run --output data/libraries.preview.json
```

Importa los centros municipales (bibliotecas y salas de estudio y lectura):

```sh
uv run biblioradar-ingest
```

Se descargan por HTTPS dos JSON-LD oficiales: bibliotecas (conjunto 201747, `source = madrid:201747`) y salas de estudio y lectura (conjunto 217921, `source = madrid:217921`). `--datasets bibliotecas` o `--datasets salas` limita la descarga. El JSON de salas contiene saltos de línea sin escapar dentro de cadenas y se lee en modo tolerante. Sus oficinas de información juvenil, que comparten catálogo, se ignoran por tipo. Todos los registros se validan antes de escribir. Un único upsert REST de PostgREST aplica el catálogo en una transacción; las repeticiones conservan los UUID internos y no crean duplicados. Hay timeout y hasta cuatro intentos para errores transitorios. Errores de autenticación o de esquema no se reintentan. Código de salida 0: correcto; 1: fallo. No elimina bibliotecas ausentes en una descarga posterior.

También puedes repetir la prueba con un JSON descargado:

```sh
uv run biblioradar-ingest --input data/catalogo.json --dry-run
uv run biblioradar-ingest --input bibliotecas=data/bibliotecas.json --input salas=data/salas.json --scope all --dry-run
```

Con `--input` no se descarga nada: solo se usan los ficheros indicados. Una ruta sin prefijo se interpreta como catálogo de bibliotecas.

Por defecto, un registro inválido cancela la importación. `--allow-skips` permite excluir explícitamente los registros problemáticos, indicando los errores por número de registro.

### Alcance y titularidad

El catálogo de bibliotecas incluye también la red de la Comunidad de Madrid. El alcance predeterminado (`municipal`) importa los centros clasificados como `ayuntamiento`; `all` añade los de la Comunidad:

```sh
uv run biblioradar-ingest --scope all --dry-run
uv run biblioradar-ingest --scope all
```

La fuente no trae un campo de titularidad. Se deduce, en este orden:

1. `ayuntamiento` si el nombre contiene “Municipal”.
2. `comunidad` si contiene “Biblioteca Pública” sin “Municipal” (Pedro Salinas, Rafael Alberti, José Hierro de Usera…), “Biblioteca Regional” o “Comunidad de Madrid”. Incluye la Biblioteca Pública del Estado Manuel Alvar, que gestiona la Comunidad.
3. `ayuntamiento` si contiene “Sala de estudio/lectura”, “Aula de estudio”, “Centro cultural/sociocultural” o similares, si procede del catálogo municipal de salas o si su URL es de `madrid.es`.
4. `otra` en cualquier otro caso.

Un JSON de correspondencias verificadas tiene prioridad. La clave puede ser el id oficial o `source:id` cuando haya ambigüedad entre catálogos:

```json
{"25526": "comunidad", "madrid:217921:12813557": "otra"}
```

```sh
uv run biblioradar-ingest --scope all --institution-overrides instituciones.json
```

Los valores válidos son `ayuntamiento`, `comunidad`, `ucm` y `otra`. No se agrega un catálogo UCM separado.

### Coordenadas y horarios

Se validan coordenadas WGS84 numéricas dentro del entorno de Madrid; se rechazan NaN, infinito, ejes invertidos y UTM. Se limpian HTML, entidades y espacios. El distrito se normaliza al nombre oficial con tildes (“Chamberí”, “Puente de Vallecas”). Si la URI viene rota (`.../Distrito/Distrito`) o vacía, como en algunas salas, se toma del paréntesis final del nombre.

`opening_hours` conserva `raw_text`, añade `normalized_text`, `timezone: Europe/Madrid`, `weekly: null` y `requires_review: true`. El texto puede mezclar verano, cierres y festivos: **no se inventa un calendario semanal**. El planificador usa horarios revisados o consulta conservadoramente cuando faltan. Cada ingesta renueva estos campos desde la fuente; guarda enriquecimientos manuales por separado antes de incorporarlos al flujo.

## Reportes preparados para la Fase 3

Lectura pública de `libraries` y `occupancy_status`. `user_reports` no admite lectura ni escritura directa para `anon` o `authenticated`; los datos personales tampoco se publican en Realtime. La escritura pública pasa exclusivamente por:

```javascript
const { data: reportId, error } = await supabase.rpc('submit_report', {
  p_library_id: libraryId,
  p_reported_value: 30, // 30, 75 o 100
  p_device_hash: deviceHash, // SHA-256 hexadecimal minúsculo, 64 caracteres
  p_user_lat: latitude,
  p_user_lng: longitude,
});
```

El trigger usa Haversine con radio terrestre 6.371.000 m y rechaza distancias **>= 250 m**. La hora la asigna el servidor. Un bloqueo transaccional por biblioteca/dispositivo evita que peticiones simultáneas eludan el límite de 30 minutos. El cliente no puede editar ni borrar reportes. El trigger de la Fase 2 recalcula inmediatamente el agregado y excluye reportes de más de 90 minutos en cada recálculo.

Estas barreras validan la posición **declarada**: un navegador puede falsear GPS o cambiar el identificador local. No son una prueba de presencia física ni una identidad resistente a ataques. Antes de una apertura pública con tráfico, se podrá añadir protección de abuso en el endpoint. El hash debe derivarse de un identificador aleatorio local y señales mínimas; no se pide email.

Los 90 minutos son la ventana de influencia, no una política de conservación. Para limitar el histórico privado, se recomienda programar posteriormente la eliminación de reportes de más de 7 días, según las necesidades del producto. Si se introduce otro plazo, conservar al menos los 30 minutos necesarios para limitar reportes.

## Verificación

```sh
uv run pytest -q
uv run ruff check .
```

Los tests cubren la limpieza, coordenadas inválidas, filtrado, duplicados, formato de origen, modo estricto, modo simulación, payload de upsert y reintentos. `pglast` comprueba la sintaxis SQL externa, pero no ejecuta ni valida los cuerpos PL/pgSQL. La migración y `tests/supabase_smoke.sql` también se han ejecutado correctamente en PostgreSQL embebido (PGlite), con roles Supabase simulados: inicialización, RPC, RLS, geofencing, límite de reportes y etiquetas. Esta comprobación no valida el transporte de Supabase Realtime ni sustituye la prueba en tu proyecto. Para repetirla en Supabase, ejecuta `tests/supabase_smoke.sql` como `postgres` después de las dos migraciones: termina con `ROLLBACK` y no conserva los datos de prueba.

Tras aplicar las migraciones e importar, ejecuta en SQL Editor:

```sql
select institution, count(*) from public.libraries group by institution;
select count(*) as sin_estado from public.libraries l
left join public.occupancy_status s on s.library_id = l.id
where s.library_id is null; -- esperado: 0
select count(*) as estados_desconocidos from public.occupancy_status
where final_occupancy_pct is null;
```

## Fuente y atribución

Fuente: **Ayuntamiento de Madrid**, conjuntos 201747 (Bibliotecas de Madrid) y 217921 (Salas de estudio y lectura), licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- [Ficha oficial y condiciones del conjunto 201747](https://datos.madrid.es/dataset/201747-0-bibliobuses-bibliotecas)
- [Distribución JSON oficial 201747](https://datos.madrid.es/dataset/201747-0-bibliobuses-bibliotecas/resource/201747-2-bibliobuses-bibliotecas-json/download/201747-0-bibliobuses-bibliotecas.json)
- [Ficha oficial del conjunto 217921](https://datos.madrid.es/dataset/217921-0-salas-estudio)
- [Distribución JSON oficial 217921](https://datos.madrid.es/dataset/217921-0-salas-estudio/resource/217921-0-salas-estudio-json/download/217921-0-salas-estudio.json)
- [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: funciones y permisos](https://supabase.com/docs/guides/database/functions)

Los datos se transforman mediante limpieza y filtrado; no son aforos en vivo. Mantener esta atribución visible en el futuro frontend.

Validación de las descargas oficiales del 24 de octubre de 2026. Bibliotecas: 52 registros (36 municipales y 16 de la Comunidad). Salas: 68 registros, de los que 67 son salas y 1 oficina juvenil ignorada. Con `--scope all` resultan 119 centros (103 `ayuntamiento`, 16 `comunidad`) en los 21 distritos, sin registros rechazados. La vista previa local se encuentra en `data/libraries.preview.json`. La cantidad puede cambiar en futuras actualizaciones del catálogo.


## Fase 2: instalación y ejecución

Sobre el proyecto que ya tiene la Fase 1, ejecuta **una vez** `supabase/migrations/202610230002_phase2_fusion.sql` como `postgres`, o aplica las migraciones pendientes con Supabase CLI. No vuelvas a aplicar la primera migración. Esta migración añade las funciones y el trigger; no habilita ningún cron dentro de la base de datos.

```sh
uv sync --locked
uv run python -m biblioradar.update_job --dry-run --output data/bases.preview.json
uv run python -m biblioradar.update_job
```

`--dry-run` lee el catálogo de Supabase y consulta las fuentes reales, pero no llama a la RPC de escritura; requiere las mismas variables `.env`. La vista previa contiene las bases calculadas, no una copia de los reportes privados ni una simulación del agregado final. El proceso devuelve 1 si fallan la configuración, la lectura de Supabase o la escritura; un fallo aislado de una fuente se registra y permite continuar con las demás bibliotecas. Una ejecución con todas las fuentes vacías puede devolver 0: consulta el resumen `bases disponibles` y los mensajes de fallo para evaluar la cobertura.

El catálogo se pagina en orden de UUID. El job envía lotes de hasta 1000 bases a `update_occupancy_bases`, reservada a `service_role`. Cada lote se aplica y fusiona dentro de una sola transacción. El cron no escribe `crowd_pct`, contadores ni el resultado final calculados fuera de la base de datos. Si falla un lote posterior, los lotes anteriores ya confirmados permanecen aplicados; volver a ejecutar es seguro.

### Fórmula y paridad

`engine.predict_base` usa el valor Google en vivo, incluso si es 0. Solo cuando falta usa el histórico de la hora local de Madrid, con ×1,25 en los periodos inclusivos 15 noviembre–31 enero y 25 abril–30 junio, y ×1,10 si llueve. Se limita a 100 y se redondea a entero con mitades hacia arriba para almacenarlo en `predicted_base_pct`. Un aforo directo UCM se utiliza sin multiplicadores.

`engine.fuse` y `recalculate_library_occupancy` filtran reportes de antigüedad entre 0 y 90 minutos inclusivos, descartan fechas futuras y aplican:

```text
w = exp(-minutos / 45)
media = sum(valor * w) / sum(w)
confianza = min(0.85, sum(w) * 0.35)
final = round(media * confianza + base * (1 - confianza))
```

La media no se redondea antes de la fusión. `crowd_pct` se almacena redondeado para mostrarlo. El redondeo final usa mitades hacia arriba, como `round(numeric)` de PostgreSQL, en vez del redondeo al par de `round()` de Python. El cálculo Python centra la suma ponderada para preservar medias constantes exactas. Las edades se calculan como tiempo transcurrido UTC, incluso durante el cambio de hora de Madrid.

Sin reportes se conserva la base y `crowd_pct` queda `NULL`. Sin base pero con reportes se usa su media ponderada. Sin ninguna fuente se mantienen porcentaje y etiqueta `NULL`.

### Trigger, concurrencia y caducidad

Tras una inserción aceptada por `submit_report`, el trigger `AFTER INSERT` llama a la fusión y la confirma dentro de la misma transacción del reporte. RLS sigue ocultando los reportes; Realtime publica el cambio de `occupancy_status` al confirmar la transacción. El bloqueo de fila por biblioteca serializa la fusión frente al cron y otros reportes; el agregado se lee después de tomar el bloqueo. Los lotes bloquean bibliotecas ordenadas por UUID. Los advisory locks de la Fase 1 siguen protegiendo el límite por dispositivo.

Cada base incorpora `base_source`, `base_observed_at` y `base_valid_until` (60 minutos desde su recepción). Un recálculo excluye bases caducadas. Si una consulta nueva falla, nunca se prolonga el dato anterior: se usa la estimación horaria descrita abajo o, si no procede, base `NULL`. Las marcas de tiempo indican recepción, no una garantía de frescura interna del proveedor. UCM no proporciona fecha de medición en el contrato observado del widget.

**El paso del tiempo no dispara triggers.** El cron vuelve a calcular las bibliotecas, incluso cerradas o sin fuente, para retirar la influencia de reportes antiguos. Entre ejecuciones la tabla es una instantánea, por lo que la retirada por caducidad puede demorarse hasta el siguiente recálculo. Fuera de la ventana del cron o si GitHub se retrasa puede tardar más. El futuro frontend debe mostrar `updated_at`, vigencia y estado desactualizado; la emisión de Realtime se ha preparado en SQL, pero no se ha probado una conexión WebSocket a tu Supabase.

### Estimación horaria de respaldo

Si Google no da popularidad (ni en vivo ni histórica) y el centro no consta como cerrado, `engine.heuristic_base` genera una base con `base_source = "Estimación horaria + contexto Madrid"`:

- **Curva de un día laborable:** pico de mañana 9–14 h (máximo 62 % a las 12) y pico de tarde 16–20:30 h (62 % a las 18), con valle a mediodía.
- **Contexto del centro (`engine.library_points`):** puntos que se suman a la curva, completos en hora punta (62 %) y proporcionales a la curva el resto del día, para no inflar aperturas y cierres:
  - UCM o Comunidad de Madrid: +8 entre semana y +12 en fin de semana, porque se llenan antes.
  - Sala dedicada (“Sala/Aula/Espacio de estudio/lectura”) frente a centro cultural o biblioteca general: +6.
  - Distritos con mucha población estudiante (Moncloa-Aravaca, Chamberí, Centro, Ciudad Lineal, Salamanca, Retiro): +5.
  - Variación estable de −7 a +7 derivada del SHA-256 del `id`. Es la misma en cada ejecución y evita que centros idénticos marquen exactamente lo mismo.
- **Ajustes de calendario:** sábado ×0,75 y domingo ×0,65 (×0,95 y ×0,90 en exámenes), exámenes ×1,25 y lluvia ×1,10.
- **Límites:** nunca devuelve 0 ni más de 90 %. Una heurística no declara un centro lleno.
- **Cerrado:** el horario revisado de la ficha manda; si falta, el horario estructurado de Google; y si falta también, en fin de semana, el texto publicado. Cualquiera de ellos indicando cierre deja la base `NULL` con `base_source` “Cerrada según…”.
- **Fin de semana por texto (`update_job.published_weekend_status`):** para centros sin horario estructurado se lee el texto del catálogo. Cuenta la fórmula de la Comunidad “Apertura de lunes a sábado/domingo”, y frases con “sábado(s)”, “domingo(s)”, “fines de semana”, “lunes a domingo” o “todos los días” con su tramo horario. Si hay tramos (“Sábados de 9 a 14 horas”), se respetan; si no, se usa la franja 8:30–21:00. Se ignoran las frases de temporada (“Julio: …”, “Verano (…): …”) y las fechas de cierre concretas (“Días de cierre: sábados: 4 de abril…”). “Todos los días los servicios… finalizarán…” no cuenta como apertura. Ante señales contradictorias gana el cierre.
- **Horario desconocido:** sin ninguna de esas fuentes solo se estima de lunes a viernes de 8:30 a 21:00. En fin de semana o de noche la base queda `NULL`.

Con el catálogo actual de 119 centros, un viernes a las 14:00 la estimación va de 40 a 58 % con 18 valores distintos, en lugar de 45 % en todos. Un sábado a las 12:00 se estiman 69 centros abiertos según su texto, y 39 constan cerrados.

Los reportes de estudiantes se fusionan con esta base como con cualquier otra.

### Fuentes de concurrencia y límites observados

- **Open-Meteo:** consulta única por ejecución en 40.4168, −3.7038, con `current=rain,showers` en UTC. Lluvia o chubascos > 0 mm activan el ajuste; la nieve no. Se rechazan datos incompletos, negativos, unidades inesperadas o datos de más de una hora. Si el clima falla, se calcula sin multiplicador de lluvia y se indica `clima no disponible` en las estimaciones históricas. No se interpreta el fallo como una observación de tiempo seco. [Documentación oficial](https://open-meteo.com/en/docs).
- **Google Maps:** búsqueda pública `search?tbm=map&tch=1`. La consulta usa el nombre sin el distrito entre paréntesis y la dirección sin coletillas administrativas (“JUNTO A…”, “EN C. CULTURAL…”, “PLANTA…”). El parser usa JSON y nunca ejecuta JavaScript. Acepta el Place ID guardado o, sin él, un resultado a menos de 300 m cuyo nombre coincida. Vale el nombre idéntico o que comparta al menos el 75 % de las palabras distintivas, ignorando “biblioteca”, “pública”, “municipal”, “sala”… Por ejemplo, “Biblioteca Iván de Vargas” casa con “Biblioteca Pública Municipal Iván de Vargas (Centro)”. Si el nombre no es idéntico, el resultado debe ser una biblioteca o sala, o el mismo centro cultural que la contiene: así una parroquia cercana con el mismo nombre no se asocia. Empates entre lugares distintos se rechazan. Del resultado se lee además el horario estructurado del día (índice 203), que permite saber si está abierta ahora. En octubre de 2026 la búsqueda ya no incluía la gráfica de afluencia en ninguna de las 119 fichas probadas. Por eso, si falta, se intenta la ficha `maps?q=place_id:…` y, después, el JSON `/maps/preview/place?…` que esa página enlaza para su panel lateral. Las peticiones a Google llevan la cookie de consentimiento europeo `SOCS` y `Accept-Language: es-ES,es;q=0.9`. Se envían como cabecera de cada petición, solo a `www.google.com`, no en el cliente compartido. Cualquier redirección a otro host (p. ej. `consent.google.com`) se trata como fallo. La gráfica no se busca en un índice fijo (antes `[84]`), sino por su forma en todo el árbol de la ficha: 7 días ISO distintos, cada uno con `[hora 0..23, % 0..100, …]`. El % actual se lee de la posición 7 del bloque que contiene esa semana. En una prueba real del 24-10-2026 con la cookie, las tres respuestas (búsqueda, página y ficha JSON) llegaron sin redirección, con horario pero sin gráfica de afluencia, incluso en lugares muy concurridos como el Mercado de San Miguel. Google parece servirla solo a clientes que ejecutan JavaScript. El detector queda preparado por si vuelve o por si se sirve desde otra región. Usa el día ISO y la hora de Madrid para el histórico. Ceros explícitos se conservan; horas ausentes permanecen desconocidas. La estructura de popularidad es interna y puede cambiar, bloquearse o requerir consentimiento. No usa claves ni la API de pago. El formato se contrastó con el [conector de referencia populartimes](https://github.com/m-wrzr/populartimes); no se añade esa dependencia ni se garantiza cobertura de todas las bibliotecas. La comprobación real pudo identificar Aluche, pero no recibió popularidad para ella. La popularidad relativa de Google **no equivale a porcentaje certificado de puestos ocupados**.
- **UCM:** adaptador real para **María Zambrano**, cuando `institution='ucm'` y el nombre coincide. La [guía oficial UCM](https://biblioguias.ucm.es/horarios-bibliotecas/horarios-bmz) incluye actualmente el [widget público](https://dashboard.sitesandstats.com/demo/76487236). Se obtienen del widget sus parámetros públicos temporales y se consulta su proveedor fijo; no se guardan tickets en el repositorio. Se valida biblioteca y sala y se lee únicamente `json.flowTpc` actual, ignorando las predicciones `hours`. Se verificó una respuesta HTTP 200 con aforo válido. Otras bibliotecas UCM sin adaptador verificado pasan al conector Google. El enlace antiguo de Affluences de otra página UCM devolvía 404. El aforo de personas no garantiza disponibilidad de puestos: la propia UCM advierte de puestos reservados durante pausas.

La ingesta de la Fase 1 no incluye María Zambrano. Para usar ese adaptador hay que incorporar una ficha UCM verificada al catálogo con su institución, nombre, dirección y coordenadas. No se crean fichas ni se inventan UUID automáticamente en esta fase.

### Horarios revisados

Si `requires_review` es `true` o no hay calendario estructurado, se consulta conservadoramente en la ventana del cron, sin deducir aperturas desde texto libre. Para omitir scraping cuando se conoce el cierre, el job acepta:

```json
{
  "timezone": "Europe/Madrid",
  "requires_review": false,
  "weekly": {
    "1": [["09:00", "21:00"]], "2": [["09:00", "21:00"]],
    "3": [["09:00", "21:00"]], "4": [["09:00", "21:00"]],
    "5": [["09:00", "21:00"]], "6": [["09:00", "14:00"]], "7": []
  },
  "date_overrides": {"2026-12-25": []}
}
```

ISO 1=lunes…7=domingo; fin de intervalo exclusivo. Se admiten `24:00` y franjas que cruzan medianoche. Un cierre se expresa como `[]`. Las excepciones por fecha tienen prioridad. No se escribe 0 % por estar cerrado: se retira la base y se conserva su explicación. La ingesta original renueva `opening_hours`, por lo que los horarios revisados necesitan preservarse mediante un flujo de enriquecimiento antes de volver a importar.

### GitHub Actions

`.github/workflows/update_occupancy.yml` ejecuta el cron a las **06:00, 06:20, …, 21:40 y 22:00 UTC** (49 ejecuciones diarias), conforme a la ventana solicitada. En Madrid equivale a 07:00–23:00 en invierno y 08:00–00:00 en verano. No cubre aperturas de 24 horas fuera de esa ventana.

Sube el repositorio y configura en **Settings → Secrets and variables → Actions**:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Aplica antes las migraciones en el proyecto. El cron solo se activa desde la rama predeterminada. La ejecución manual arranca por defecto en modo simulación. Los eventos push/PR ejecutan comprobaciones sin credenciales de producción; los eventos de cron/manual ejecutan la actualización después de pasar CI. Los jobs comparten exclusión por rama para evitar solaparse.

CI instala con `uv --locked`, ejecuta `ruff`, `pytest` y parsea las migraciones con `pglast`. Además arranca un PostgreSQL 16 desechable para aplicar ambas migraciones, ejecutar el smoke y comparar siete casos de fusión con Python. Los jobs tienen permisos de lectura del repositorio y las fuentes externas no reciben las credenciales Supabase. No se ha publicado el workflow ni configurado secretos desde este entorno.

GitHub puede retrasar ejecuciones programadas y no es un temporizador exacto. La gratuidad depende de las cuotas y modalidad de tu cuenta y de los proveedores; no se garantiza coste cero para cualquier volumen. [Documentación de schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

### Verificación de la Fase 2

```sh
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

Resultado local: **85 pruebas superadas y 1 omitida**, la integración que requiere un servidor PostgreSQL y `psql`. Ambas migraciones, el smoke ampliado y los siete casos de paridad se ejecutaron también correctamente con PostgreSQL embebido (PGlite). Este último no prueba conexiones concurrentes ni el transporte Realtime de Supabase.

Para ejecutar la integración nativa local, usa una base PostgreSQL **vacía y desechable** con un usuario administrador, `psql` en PATH y `TEST_DATABASE_URL` configurada; después ejecuta `uv run pytest tests/test_database.py -q`. La prueba crea roles y aplica migraciones, por lo que no debe apuntar a una base existente ni de producción. En CI esta integración está preparada con el servicio temporal de PostgreSQL.
