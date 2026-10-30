"""Pruebas PostgreSQL reales en CI; omitir si no se configuró TEST_DATABASE_URL."""

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from biblioradar.engine import Report, fuse

ROOT = Path(__file__).resolve().parents[1]


def parity_case():
    """Casos alejados de empates: toleran los milisegundos de ejecución del servidor."""
    vectors = [
        (80, [(30, 1)]),
        (55, [(30, 1), (100, 45)]),
        (None, [(75, 1), (100, 30)]),
        (40, [(100, 91), (30, -5)]),
        (80, [(30, 1)] * 8),
        (None, []),
        (0, [(100, 10)]),
        (62, [(20, 2), (40, 12), (90, 33)]),
        (None, [(90, 5), (20, 50)]),
    ]
    now = datetime.now(timezone.utc)
    sql = ["begin;"]
    expected = []
    for index, (base, reports) in enumerate(vectors, 1):
        library_id = f"00000000-0000-0000-0000-{index + 100:012d}"
        sql.append(f"""insert into public.libraries
          (id,source,source_id,name,institution,address,district,lat,lng)
          values ('{library_id}','test','parity-{index}','Test','otra','Test','Test',40.4,-3.7);
          update public.occupancy_status set predicted_base_pct = {base if base is not None else "null"}
          where library_id = '{library_id}';""")
        for report_index, (value, age) in enumerate(reports):
            device = f"{report_index:064x}"
            sql.append(f"""insert into public.user_reports
              (library_id,reported_value,device_hash,user_lat,user_lng)
              values ('{library_id}',{value},'{device}',40.4,-3.7);
              update public.user_reports set created_at = '{now.isoformat()}'::timestamptz
                - interval '{age} minutes'
                where library_id = '{library_id}' and device_hash = '{device}';""")
        sql.append(f"select public.recalculate_library_occupancy('{library_id}');")
        result = fuse(
            base, [Report(value, now - timedelta(minutes=age)) for value, age in reports], now
        )
        expected.append(
            {
                "id": library_id,
                "final": result.final_occupancy_pct,
                "crowd": result.crowd_pct,
                "count": result.active_reports_count,
            }
        )
    sql.append("""select json_agg(x order by id) from (
      select library_id as id, final_occupancy_pct as final, crowd_pct as crowd,
        active_reports_count as count from public.occupancy_status
        where library_id::text like '00000000-0000-0000-0000-0000000001%'
      ) x;""")
    sql.append("rollback;")
    return "\n".join(sql), expected


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL") or not shutil.which("psql"),
    reason="Se requiere PostgreSQL de pruebas y psql",
)
def test_postgresql_migrations_smoke_and_python_parity():
    dsn = os.environ["TEST_DATABASE_URL"]

    def execute(sql):
        result = subprocess.run(
            ["psql", dsn, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
            input=sql,
            text=True,
            capture_output=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stderr
        return result.stdout

    execute("""create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;""")
    for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        execute(migration.read_text())
    execute((ROOT / "supabase/migrations/202610280007_occupancy_cron.sql").read_text())
    execute((ROOT / "tests/occupancy_cron_smoke.sql").read_text())
    execute((ROOT / "tests/supabase_smoke.sql").read_text())
    execute((ROOT / "tests/csv_bayesian_smoke.sql").read_text())
    execute((ROOT / "supabase/migrations/202610280005_csv_bayesian.sql").read_text())
    execute((ROOT / "supabase/migrations/202610280008_catalog_expansion.sql").read_text())
    execute((ROOT / "supabase/migrations/202610290009_archetype_precision.sql").read_text())
    execute((ROOT / "supabase/migrations/202610290011_report_priority.sql").read_text())
    execute((ROOT / "supabase/migrations/202610300012_report_memory.sql").read_text())
    execute((ROOT / "tests/archetype_smoke.sql").read_text())
    execute((ROOT / "tests/feedback_smoke.sql").read_text())
    execute((ROOT / "supabase/migrations/202610280006_feedback_cooldown.sql").read_text())
    execute((ROOT / "supabase/migrations/202610290010_official_capacities.sql").read_text())
    execute((ROOT / "tests/capacities_smoke.sql").read_text())
    execute((ROOT / "tests/report_priority_smoke.sql").read_text())
    execute((ROOT / "tests/report_memory_smoke.sql").read_text())
    sql, expected = parity_case()
    output = execute(sql)
    # jsonb_agg (PostgreSQL 16) separa los elementos con saltos de línea: decodificar el bloque
    # JSON completo desde la primera línea que empieza por "[", no solo esa línea.
    start = re.search(r"^\[", output, re.MULTILINE)
    assert start, output
    actual, _ = json.JSONDecoder().raw_decode(output[start.start() :])
    assert actual == expected
