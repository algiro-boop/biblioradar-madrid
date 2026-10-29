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

La incidencia previa de Gloria Fuertes se ha corregido separando las identidades físicas, como se detalla a continuación.

## Tamaño y sincronización

El cliente exige 97 filas completas por defecto y rechaza catálogos truncados. Una futura ampliación explícita puede usar `--expected-rows N`. La migración `202610280008_catalog_expansion.sql` sustituye el requisito fijo de 88 por un mínimo de 88 y comprueba que el número de UUID, nombres y centros activos coincida con la longitud del lote. Mantiene permisos, atomicidad, reportes, coordenadas existentes y el cron de cinco minutos.

SHA256 del CSV anterior de 94 filas: `1c7ee48f7a22215c582cdd84864ac87aaef0c8469be0dc31f737bb3d19f6bdf1`.


## Corrección de Gloria Fuertes — 95 centros activos

- **Centro Cultural Gloria Fuertes (Barajas)**: Av. de Logroño, 179, Barajas, 28042 Madrid. Conserva UUID `15e27271-a7ab-4cfb-a65a-9ab63e4e8d6c`, distrito y coordenadas originales de Barajas (`40.460559472287, -3.59374618117853`). Se han sustituido el nombre, dirección, tipo, teléfono, horarios y curva que pertenecían a la biblioteca de Rivas. Horario del CSV suministrado: L–V 07:30–22:00; sábados y domingos cerrado. No se transfieren las 282 reseñas ni la valoración de Rivas a este centro: se dejan sin valoración y con cero reseñas conocidas.
- **Biblioteca Gloria Fuertes (Rivas)**: C. Jovellanos, 30, 28522 Rivas-Vaciamadrid. Nueva ficha `f9500e30-9722-5aa7-b781-5fd22bf82ebe`, distrito Rivas-Vaciamadrid, coordenadas `40.3493674, -3.5264018`. Mantiene metadatos, horarios y curva del registro de biblioteca del CSV anterior. Las tres curvas estimadas de Rivas siguen referenciando esta biblioteca, con su nombre actualizado.

Las coordenadas de Rivas proceden del mapa de su [ficha municipal](https://sede-electronica.rivasciudad.es/equipamiento/biblioteca-gloria-fuertes/), corroboradas a pocos metros por la [ficha de la Comunidad de Madrid](https://www.comunidad.madrid/centros/biblioteca-municipal-gloria-fuertes-rivas-vaciamadrid). El teléfono del centro de Barajas, 913120243, figura en el [directorio municipal de centros culturales](https://www.madrid.es/portales/munimadrid/es/Inicio/El-Ayuntamiento/Publicaciones/Listado-de-Publicaciones/DS-Centros-Culturales/?page=1&vgnextchannel=f1aebadb6b997010VgnVCM100000dc0ca8c0RCRD&vgnextfmt=default&vgnextoid=1831b21acfa83410VgnVCM1000000b205a0aRCRD).

`data/csv/sources/centro_cultural_gloria_fuertes.csv` conserva el archivo suministrado de 92 filas. `import_long_popularity` exige los siete días, las 18 horas de cada día abierto, horarios coherentes, porcentajes válidos y ausencia de duplicados. Una fila explícita de cierre se convierte en 18 ceros. El CSV maestro contiene sus 90 porcentajes de lunes a viernes sin inferir ni interpolar huecos durante la importación.

Las correspondencias de ambos UUID son explícitas. Las altas con UUID verificado pueden sembrarse aunque aún exista el nombre ambiguo anterior; las siguientes sincronizaciones reutilizan ese UUID, sin duplicar centros ni cambiar coordenadas existentes. Los reportes conservan su biblioteca física original. El cron continúa recalculando todas las fichas activas cada cinco minutos.

SHA256 del CSV anterior de 95 filas: `b87370e9025a9716d927cac6c6ad760edf1f858d739b6e4a4115de2aba61de84`.


## Julio Cortázar y La Fortuna — 29 de octubre de 2026

El catálogo pasa a 97 activos: se reactiva Centro Cultural Julio Cortázar con su UUID `8721aec8-df5d-4c86-9562-78601e7045d9` y sus coordenadas originales. Se añade Biblioteca Enrique Tierno Galván (La Fortuna) con UUID determinista `4666cc9b-c2ee-5513-9721-d8efef9d079f`, ubicación `40.35824, -3.78453`, distrito `La Fortuna (Leganés)` e institución `otra`, tal como indicó el usuario. La URL de Leganés se guarda como URL HTTPS normal, sin la sintaxis Markdown del mensaje.

Las 95 filas anteriores permanecen intactas. Los horarios, valoraciones, reseñas, teléfonos, direcciones y coordenadas nuevos son los suministrados por el usuario. Los porcentajes son supuestos arquetípicos, no Popular Times observados:

- Julio Cortázar abre todos los días de 09:00 a 21:00. Puntos 09–20: `18, 30, 42, 45, 35, 24, 28, 40, 55, 62, 50, 28`.
- La Fortuna abre L–V 15:00–21:00. Puntos 15–20: `25, 40, 58, 70, 58, 35`.
- La Fortuna abre sábados y domingos 10:30–19:30. Puntos 10–19: `20, 32, 45, 42, 28, 30, 45, 58, 52, 25`. Los puntos 10 y 19 incluyen franjas parcialmente abiertas; el motor evalúa la hora exacta y muestra cerrado antes de 10:30 o desde 19:30.

El resto de los puntos queda a cero. `curve_provenance.json` registra el método y `kind: archetype, kappa: 6` para ambos centros. El importador valida esa precisión explícita. La migración 009 mantiene κ=6 en el motor SQL aunque la curva esté completa, sin cambiar la precisión del resto del catálogo. `tests/archetype_smoke.sql` lo verifica con un reporte de peso 20: confianza `20/(6+20)`, seguida de una comprobación de la precisión normal y de la expiración del reporte. Se ejecuta con rollback en la base de pruebas, no inserta reportes de prueba en producción.

SHA256 actual del CSV de 97 filas: `d95bd5038d0329b7c3c512607f4efc4f9808d953cc0342a397d2ae4a0e38d8d5`.
