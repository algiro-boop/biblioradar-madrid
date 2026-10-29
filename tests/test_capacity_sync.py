"""Audit-driven capacity sync. Numeric fixtures here are synthetic, never production data."""

import csv
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import pytest
from pglast import parse_sql

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("capacity_sync", ROOT / "sync_csv_to_supabase.py")
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def entry(name="Fixture", capacity=100):
    return {
        "name": name,
        "capacity": capacity,
        "reason": "verified_explicit_total",
        "raw_evidence_text": "Puestos de lectura: 100",
        "source_url": "https://datos.madrid.es/test",
    }


def test_null_clears_existing_capacity_without_using_legacy_seats():
    rows = [{"name": "Fixture", "total_capacity": 999, "total_seats": 999}]
    sync.apply_verified_capacities(rows, [entry(capacity=None)])
    assert rows[0]["total_capacity"] is None
    assert rows[0]["total_seats"] == 999


@pytest.mark.parametrize("capacity", [0, -1, 1.5, "100", True, 2147483648])
def test_invalid_capacity_rejected(capacity):
    with pytest.raises(ValueError):
        sync.apply_verified_capacities([{"name": "Fixture"}], [entry(capacity=capacity)])


@pytest.mark.parametrize(
    "changes",
    [
        {"reason": "estimated"},
        {"raw_evidence_text": ""},
        {"source_url": None},
    ],
)
def test_unverified_values_rejected(changes):
    with pytest.raises(ValueError):
        sync.apply_verified_capacities([{"name": "Fixture"}], [{**entry(), **changes}])


@pytest.mark.parametrize("audit", [[], [entry(), entry()], [entry(name="Wrong")], {}])
def test_coverage_and_unique_names_are_mandatory(audit):
    with pytest.raises(ValueError):
        sync.apply_verified_capacities([{"name": "Fixture"}], audit)


def test_production_audit_is_exactly_81_verified_and_16_null_and_matches_payload():
    with (ROOT / "data/csv/bibliotecas_madrid_popular_times.csv").open() as handle:
        rows = sync.prepare(list(csv.DictReader(handle)))
    audit = json.loads((ROOT / "data/csv/verified_capacities_audit.json").read_text())
    sync.apply_verified_capacities(rows, audit)
    assert len(rows) == 97
    assert sum(r["total_capacity"] is not None for r in rows) == 81
    assert sum(r["total_capacity"] is None for r in rows) == 16
    indexed = {r["name"]: r["capacity"] for r in audit}
    assert all(row["total_capacity"] == indexed[row["name"]] for row in rows)
    catalog = [{"id": str(uuid4()), "name": r["name"], "lat": 40.4, "lng": -3.7} for r in rows]
    matched, problems = sync.match_catalog(rows, catalog, {r["name"]: r["id"] for r in catalog})
    assert not problems
    assert all(row["total_capacity"] == indexed[row["name"]] for row in matched)


def test_capacity_migration_and_smoke_parse():
    for filename in [
        "supabase/migrations/202610290010_official_capacities.sql",
        "tests/capacities_smoke.sql",
    ]:
        assert parse_sql((ROOT / filename).read_text())
