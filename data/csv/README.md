# Ampliación a 94 centros — 28 de octubre de 2026

El CSV añade seis filas sin modificar las 88 originales. Francisco Ayala se reactiva con UUID `c81bb808-9d4a-4189-ade8-791c12e837d5`. Las otras cinco fichas usan UUID deterministas y las coordenadas proporcionadas por el usuario en `verified_locations.json`. Las dos José Saramago tienen correspondencias explícitas y distintas en `name_matches.json`.

## Curvas estimadas

Las seis curvas nuevas son estimaciones solicitadas por el usuario, no mediciones de Google de estos centros. `curve_provenance.json` conserva referencias y método y se incorpora a `historical_popularity.provenance` durante la importación.

- Francisco Ayala y Santiago Amón: media por día y hora de 20 bibliotecas municipales con horario L–V 08:30–21:00, adaptada a cada apertura. Si todos los donantes carecen de una hora, se usa la hora abierta más cercana de ese mismo día. Se redondea a una décima.
- Las tres bibliotecas nuevas de Rivas: curva del CSV de Gloria Fuertes, adaptada a la apertura solicitada. Su lunes original está vacío; se usa la media por hora de martes a viernes. Fines de semana cerrados.
- Hacienda de Pavones: los siete horarios del Centro Sociocultural Moratalaz, con variaciones deterministas de −3, −2, +2 o +3 puntos en horas abiertas, limitadas a 0–100. Cierres y descansos conservan cero.

## Procedencia de horarios y coordenadas

Nombres, valoraciones, reseñas, teléfonos, horarios y coordenadas de las incorporaciones proceden del documento del usuario y se aplican tal como se solicitaron. Las coordenadas suministradas tienen cuatro decimales; no se presentan como una geocodificación independiente exacta. Las fuentes siguientes ayudan a identificar los centros, pero no respaldan todos los datos suministrados:

- [Santiago Amón — Comunidad de Madrid](https://www.comunidad.madrid/centros/biblioteca-municipal-santiago-amon): publica L–V 15:00–21:00 y teléfono 912489559, distintos de los solicitados.
- [Federico García Lorca — Ayuntamiento de Rivas](https://sede-electronica.rivasciudad.es/equipamiento/centro-cultural-federico-garcia-lorca/): confirma el edificio de Plaza de la Constitución, 3. La sala de estudio y los servicios bibliotecarios pueden tener horarios distintos.
- [José Saramago — Ayuntamiento de Rivas](https://sede-electronica.rivasciudad.es/equipamiento/biblioteca-jose-saramago/): confirma Av. Covibar, 10 y 916666506; publica horario reducido los lunes.
- [Almudena Grandes — Ayuntamiento de Rivas](https://sede-electronica.rivasciudad.es/equipamiento/biblioteca-casco-antiguo/): publica L–V 16:00–21:00, teléfono 916700132 y código postal 28521, distintos de los solicitados.
- Hacienda de Pavones: la existencia de una sala de estudio pública en el nº 350 no se ha podido confirmar de forma independiente. El enlace de ubicación identifica únicamente las coordenadas suministradas.

Incidencia previa, fuera de estas seis altas: Gloria Fuertes tiene dirección de Rivas en el CSV y la ficha de Supabase, pero distrito Barajas y coordenadas `40.460559472287, -3.59374618117853`. Esta importación conserva su UUID y coordenadas existentes.

## Tamaño y sincronización

El cliente exige 94 filas completas por defecto y rechaza catálogos truncados. Una futura ampliación explícita puede usar `--expected-rows N`. La migración `202610280008_catalog_expansion.sql` sustituye el requisito fijo de 88 por un mínimo de 88 y comprueba que el número de UUID, nombres y centros activos coincida con la longitud del lote. Mantiene permisos, atomicidad, reportes, coordenadas existentes y el cron de cinco minutos.

SHA256 del CSV de 94 filas: `1c7ee48f7a22215c582cdd84864ac87aaef0c8469be0dc31f737bb3d19f6bdf1`.
