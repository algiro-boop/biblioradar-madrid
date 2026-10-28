# Catálogo CSV y ocupación bayesiana

El CSV maestro se conserva en `data/csv/bibliotecas_madrid_popular_times.csv`. La migración `supabase/migrations/202610280005_csv_bayesian.sql` añade los campos sin borrar fichas ni reportes, y puede repetirse. El cálculo vive íntegramente en PostgreSQL: el trigger de reportes y el cron llaman al mismo motor. No se duplican fórmulas en el navegador ni se consulta Google, UCM o el clima durante el mantenimiento.

## Puesta en marcha realizada

El 28 de octubre de 2026 se aplicó la migración en el editor SQL del proyecto de producción, se ejecutó la importación real y después `python -m biblioradar.csv_job`. La verificación confirmó 88 activas, 34 archivadas, 88 estados recientes y los 19 reportes previos conservados. Las coordenadas de las 119 fichas existentes permanecieron intactas. El CSV importado tiene SHA256 `726b62871ed5b5a38e7c7e7609be390a92697d9eedf90b00c670cd885fb5e9b4`.

Las copias locales de comprobación y el plan se guardan en `data/*.json`, excluidos de Git. La migración se aplicó manualmente desde Supabase porque el entorno solo dispone de URL y clave de servicio, sin conexión SQL; no se ha simulado una entrada en el historial de Supabase CLI.

## Primera carga

1. Aplicar la migración después de las cuatro anteriores, con el procedimiento de migraciones habitual del proyecto. No pegar las primeras migraciones sobre una base ya creada.
2. Configurar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env`. La clave de servicio se utiliza únicamente en Python/GitHub Actions; nunca debe llevar prefijo `NEXT_PUBLIC_`.
3. Ejecutar la simulación desde la raíz:

```sh
uv run sync_csv_to_supabase.py data/csv/bibliotecas_madrid_popular_times.csv \
  --overrides data/csv/name_matches.json \
  --new-locations data/csv/verified_locations.json \
  --dry-run
```

La simulación consulta el catálogo actual, valida 88 filas y 140 columnas y escribe `data/csv_sync_plan.json`. Revisar `unresolved`, `rows`, `new_ids` y `deactivate_details`. Ninguna coincidencia ambigua se aplica automáticamente. Para una validación completamente offline se puede añadir `--catalog data/catalogo_actual.json` si se dispone de ese snapshot; no permite combinarse con `--apply`.

4. Una vez revisado el plan, repetir el comando sustituyendo `--dry-run` por `--apply`. El script vuelve a leer el catálogo actual y llama una sola vez a `sync_csv_catalog`: altas, modificaciones, desactivación y recálculo se confirman en una misma transacción. Un error revierte todo. El servidor también exige 88 UUID y nombres distintos y valida las curvas.
5. Desplegar la web con el filtro `is_active=true` después de aplicar la migración. El workflow `update_occupancy.yml` mantiene el estado cada 15 minutos, con los mismos dos secretos en GitHub. Puede probarse manualmente con `dry_run=true`.

La primera simulación con el catálogo real de 119 fichas resolvió **85 UUID existentes y 3 altas nuevas**. Por tanto se archivan **34 fichas**, quedando 88 activas de 122 totales. El resultado difiere de 31 porque tres centros del CSV no existían en el catálogo anterior. Las coordenadas de las altas —Escuelas Pías UNED, Histórica Marqués de Valdecilla y Central UNED— y sus fuentes oficiales están en `verified_locations.json`. Las trece correspondencias manuales están en `name_matches.json`. Las coordenadas de las 85 coincidencias se conservan, incluso si un payload incluye otras.

## Actualización semanal

Reemplazar el CSV maestro y repetir simulación, revisión del plan y `--apply`. No es necesario volver a ejecutar la migración. Un centro desactivado conserva sus reportes e identificador y puede reactivarse en una importación futura. Los reportes nuevos a centros inactivos se rechazan. Si aparecen nombres nuevos, el importador se detiene: resolver la correspondencia o añadir una ubicación verificada antes de aplicar el lote.

La instalación de pandas y del cliente `supabase` queda aislada mediante las dependencias PEP 723 del script. El mantenimiento habitual usa exclusivamente `httpx` contra RPC; no añade el SDK al entorno principal del proyecto.

```sh
uv run python -m biblioradar.csv_job --dry-run
uv run python -m biblioradar.csv_job
```

El primer comando solo cuenta las bibliotecas que se actualizarían; no calcula un posterior simulado ni modifica filas. `python -m biblioradar.update_job` es un alias del mismo mantenimiento. El cron usa un bloqueo asesor para evitar ejecuciones simultáneas y el motor bloquea cada fila de estado durante el recálculo. GitHub Actions puede retrasar ejecuciones; el intervalo programado no garantiza una hora exacta de entrega.

## Horarios y datos ausentes

El importador carga automáticamente `data/csv/opening_exceptions.json` (o el fichero indicado con `--opening-exceptions`). Este objeto relaciona el nombre exacto del CSV con fechas ISO y franjas alternativas; `[]` representa un cierre de ese día. Los nombres, fechas y franjas se validan antes de aplicar el lote. Así se conservan las excepciones durante futuras sincronizaciones sin modificar las curvas ni el horario semanal. Pablo Neruda permanece cerrada del 28 de octubre al 2 de noviembre de 2026 incluidos; el martes 3 recupera su horario habitual de 08:30 a 21:00 porque no tiene excepción para esa fecha.

`opening_hours.weekly` usa días ISO `1` lunes a `7` domingo, intervalos `[["08:30","14:30"],["16:00","21:00"]]`, `[]` para cerrado y `null` para desconocido. El inicio es inclusivo y el cierre exclusivo. Se admite `24:00` como cierre, pero se rechazan intervalos nocturnos, solapados o ilegibles para no inferir aperturas equivocadas. Todo se evalúa en `Europe/Madrid`, incluidos CET/CEST.

Los puntos horarios representan franjas: una apertura a las 08:30 permite el punto 08. Fuera de las franjas abiertas se guarda cero. Solo se interpola un NaN aislado con dos vecinos conocidos en la misma franja; secuencias de dos o más huecos siguen siendo `null`. Los horarios ausentes conservan todos sus puntos como desconocidos. **La Elipa abre de lunes a viernes de 08:30 a 21:00 y cierra los fines de semana.** El CSV se ha corregido con el horario indicado por el usuario: `requires_review=false`, puntos cerrados a cero y curva existente conservada. Por ejemplo, el lunes a las 12:00 mantiene 100%; el hueco aislado del miércoles a las 14:00 se interpola a 74%. Si faltan puntos abiertos sin vecinos suficientes, permanecen a `null` para usar el fallback explícito de curva incompleta.

`nota_horario_domingo` se conserva literalmente en `sunday_note`. La advertencia del 1 de noviembre de 2026 no implica un cierre confirmado ni se convierte en festivo anual. Para un cierre excepcional se utiliza `opening_hours.date_overrides`, por ejemplo `{"2026-11-01":[]}`; tiene prioridad sobre el horario semanal. Los cambios manuales a ese JSON se sustituyen con la siguiente importación semanal. `--holidays festivos.json` acepta una lista de fechas ISO y aplica el ajuste festivo a los centros abiertos, sin inventar cierres.

## Matemática y parámetros

- Cerrado: `is_open_now=false`, prior y posterior cero, confianza 1. Horario desconocido: prior/posterior `NULL`, apertura desconocida y confianza 0. La web muestra el cierre en gris y no lo incluye en «Hay sitio».
- Curva: interpolación lineal entre hora actual y siguiente; evita atravesar pausas y desciende hasta cero al cierre. Si falta el punto de una franja abierta, se usa una base explícita de 40% con precisión menor, señalada como «curva incompleta».
- Calendario: diciembre, enero, mayo y junio ×1,20; agosto ×0,75; fecha incluida en `holidays` ×0,85. Son parámetros de producto, pendientes de calibrar con observaciones reales.
- Vecindad: reportes directos de hoy y de los últimos 90 minutos en centros activos a menos de 2,5 km; último reporte por centro/dispositivo. Compara contra la curva del vecino a la hora del reporte. Ignora desviaciones inferiores a 10 puntos, limita cada anomalía a ±15 puntos y traslada una cuarta parte de la media ponderada por proximidad y `ln(2+num_resenas)`. No usa posteriores vecinos, evitando ciclos de realimentación.
- Inercia: 80% prior nuevo y 20% ancla del **prior** anterior corregida por el cambio de curva, si ese estado abierto tiene menos de tres horas. El ancla se fija por bloques de 30 minutos. Usar el prior evita incorporar dos veces reportes ya fusionados.
- Media del prior recortada a `[0,02;0,98]`; precisión `κ=min(24,8+2·ln(1+num_resenas))`, o 6 si la curva está incompleta. Las reseñas son un indicador aproximado, no el número de observaciones de Popular Times.
- Likelihood: solo último reporte por dispositivo, entre ahora−90 minutos y ahora. Cada uno pesa `20·exp(−ln(2)·edad_min/40)`. Se mantienen la proximidad de 250 m, el bloqueo asesor antispam y el límite existente de un reporte cada 30 minutos. El formulario mantiene sus cinco niveles y el servidor conserva también el valor heredado 30.
- Posterior: `α=μκ+Σwy`, `β=(1−μ)κ+Σw(1−y)`, ocupación `round(100·α/(α+β))`.
- Confianza: fracción de precisión aportada por reportes `Σw/(κ+Σw)`. Cero significa ausencia de evidencia colaborativa reciente; **no** es una probabilidad calibrada de acierto. El 1 de un cierre expresa certeza según el horario disponible.

`prior_occupancy`, `bayesian_occupancy`, `confidence_score` e `is_open_now` se actualizan junto a las columnas originales que ya consume la web. Se mantienen las mismas suscripciones Realtime. Para CSV, la web no sustituye un posterior caducado por la heurística genérica antigua: tras 30 minutos muestra pendiente de actualización. Las tablas originales y los algoritmos antiguos permanecen para compatibilidad con fichas todavía no importadas, pero no participan en el nuevo cron.

## Verificación

```sh
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
cd web
npm test
npm run typecheck
npm run build
```

`tests/test_csv_sync.py` comprueba limpieza, horarios, coincidencias ambiguas, CSV real, RPC mockeada y parseo SQL con `pglast`. `tests/csv_bayesian_smoke.sql` ejecuta vectores Beta, vida media, deduplicación, calendario, cercanía, CET/CEST, cierres, trigger público, permisos, sync repetido y rollback del lote inválido. CI aplica todas las migraciones en PostgreSQL 16 y ejecuta esos casos mediante `tests/test_database.py`; localmente ese test se omite si no hay `TEST_DATABASE_URL` y `psql`.
