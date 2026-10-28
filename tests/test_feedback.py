from pathlib import Path

from pglast import parse_sql

ROOT = Path(__file__).resolve().parents[1]


def test_feedback_sql_parses():
    for name in [
        "supabase/migrations/202610280006_feedback_cooldown.sql",
        "tests/feedback_smoke.sql",
    ]:
        assert parse_sql((ROOT / name).read_text())
