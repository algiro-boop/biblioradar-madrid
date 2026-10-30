"""Parse the migration AND function/trigger bodies; execute behavior in PostgreSQL smoke tests."""
from pathlib import Path

from pglast import parse_plpgsql, parse_sql

ROOT = Path(__file__).resolve().parents[1]


def test_live_community_sql_parses():
    sql = (ROOT / "supabase/migrations/202610300013_live_community.sql").read_text()
    assert parse_sql(sql)
    assert parse_plpgsql(sql)
    assert parse_sql((ROOT / "tests/live_community_smoke.sql").read_text())
