# Capacidades oficiales

`data/csv/verified_capacities_audit.json` contiene los 97 centros del CSV maestro:
81 capacidades oficiales y 16 valores `null`. Las respuestas HTTP originales están
en `data/csv/capacity_sources/`; el manifiesto `.sources.json` conserva URLs,
codificación y hashes SHA-256. La sincronización reproduce la evidencia archivada
antes de conectarse a Supabase. No descarga nuevos aforos ni usa `total_seats`.

La migración `202610290010_official_capacities.sql` añade `libraries.total_capacity`
y actualiza el RPC administrativo `sync_csv_catalog`. Los `null` explícitos borran
cualquier capacidad anterior. El RPC mantiene los bloqueos y la transacción del
catálogo, conserva UUID y coordenadas y sigue restringido a `service_role`.

Para aplicar DDL por terminal, configura **una** credencial administrativa en `.env`:
`SUPABASE_ACCESS_TOKEN` para la API de gestión o `DATABASE_URL` para PostgreSQL.
La clave REST `SUPABASE_SERVICE_ROLE_KEY` no permite crear columnas.

```sh
uv run --with httpx --with python-dotenv --with 'psycopg[binary]' \
  python scripts/apply_official_capacities.py

uv run sync_csv_to_supabase.py data/csv/bibliotecas_madrid_popular_times.csv \
  --overrides data/csv/name_matches.json \
  --new-locations data/csv/verified_locations.json --dry-run

uv run sync_csv_to_supabase.py data/csv/bibliotecas_madrid_popular_times.csv \
  --overrides data/csv/name_matches.json \
  --new-locations data/csv/verified_locations.json --apply
```

El CLI requiere que la columna ya exista y compara las 97 capacidades almacenadas
con el archivo auditado después de aplicar el lote. Una auditoría incompleta,
duplicada, sin evidencia o con un hash alterado impide sincronizar.

En tarjetas y en el detalle del mapa, la aplicación muestra `~X libres de Y plazas`
cuando hay capacidad, apertura confirmada y porcentaje vigente. El total es oficial;
las plazas libres son una estimación redondeada del porcentaje de ocupación. Si está
cerrada o falta información de ocupación/apertura, muestra solo `Capacidad: Y puestos`.
Una capacidad `null` nunca añade texto de plazas ni recurre al campo heredado.

Las pruebas de renderizado usan React en Node, sin abrir navegadores. Los fixtures
numéricos de los tests son sintéticos y nunca se incorporan a la auditoría real.
