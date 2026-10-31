"""Observed source import, geographically weighted fallbacks and strict destination hours."""

import csv
import importlib.util
import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path

import pytest
from pglast import parse_plpgsql, parse_sql

from biblioradar.catalog_import import import_unified_centers
from biblioradar.update_job import opening_status
from biblioradar.zone_profiles import apply_zone_profiles, overlaps

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("sync_zone", ROOT / "sync_csv_to_supabase.py")
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def real_rows():
    rows = sync.prepare(
        list(csv.DictReader((ROOT / "data/csv/bibliotecas_madrid_popular_times.csv").open()))
    )
    locations = json.loads((ROOT / "data/csv/verified_locations.json").read_text())
    overrides = json.loads((ROOT / "data/csv/name_matches.json").read_text())
    expanded, _ = sync.expand_catalog(
        json.loads((ROOT / "tests/fixtures/zone_catalog.json").read_text()), locations, overrides
    )
    rows, problems = sync.match_catalog(rows, expanded, overrides)
    assert not problems
    sync.apply_curve_provenance(
        rows, json.loads((ROOT / "data/csv/curve_provenance.json").read_text())
    )
    sync.apply_temporary_closures(
        rows, json.loads((ROOT / "data/csv/temporary_closures.json").read_text())
    )
    return rows, expanded


def test_import_preserves_three_observed_profiles_and_five_missing_profiles():
    source = list(
        csv.DictReader(
            (ROOT / "data/csv/imports/bibliotecas_madrid_alcobendas_sanse_unificado.csv").open()
        )
    )
    rows = import_unified_centers(source, sync.COLUMNS)
    assert len(rows) == 8
    for r in rows:
        for original in (x for x in source if x["biblioteca"] == r["nombre"]):
            if original["tiene_popular_times"] == "False":
                assert not r["ocupacion_lun_12"]
    for invalid in [source[:-1], source + source[:1]]:
        with pytest.raises(ValueError):
            import_unified_centers(invalid, sync.COLUMNS)
    bad = deepcopy(source)
    bad[0]["ocupacion_pct"] = "50"
    bad[0]["tiene_popular_times"] = "False"
    with pytest.raises(ValueError):
        import_unified_centers(bad, sync.COLUMNS)


def test_real_zone_profiles_masks_and_northern_saturday():
    rows, catalog = real_rows()
    own = {r["name"]: deepcopy(r["historical_popularity"]["days"]) for r in rows}
    profiles = json.loads((ROOT / "data/csv/zone_profiles.json").read_text())
    apply_zone_profiles(rows, catalog, profiles)
    indexed = {r["name"]: r for r in rows}
    for r in rows:
        if r["name"] not in profiles:
            assert r["historical_popularity"]["days"] == own[r["name"]]
    for name in profiles:
        r = indexed[name]
        for day, slots in r["opening_hours"]["weekly"].items():
            for hour in range(6, 24):
                value = r["historical_popularity"]["days"][day][f"{hour:02}"]
                assert 0 <= value <= 100
                if not overlaps(slots, hour):
                    assert value == 0
        refs = r["historical_popularity"]["provenance"]["references"]
        assert refs and not set(refs).intersection(profiles)
    anabel = indexed["Centro Cultural Anabel Segura"]
    pablo = indexed["Centro Cultural Pablo Iglesias"]
    assert (
        anabel["historical_popularity"]["days"]["6"]["17"]
        == pablo["historical_popularity"]["days"]["6"]["17"]
    )
    hours = anabel["opening_hours"]
    assert opening_status(hours, datetime.fromisoformat("2026-10-31T16:29:00+01:00")) is False
    assert opening_status(hours, datetime.fromisoformat("2026-10-31T16:30:00+01:00")) is True
    assert opening_status(hours, datetime.fromisoformat("2026-10-31T20:00:00+01:00")) is False
    teresa = indexed["Sala de estudio y lectura Centro Sociocultural Teresa de Calcuta (Barajas)"]
    assert teresa["historical_popularity"]["days"]["7"]["12"] > 0
    for value in [
        "2026-10-31T14:00:00+01:00",
        "2026-11-01T15:59:00+01:00",
        "2026-11-01T20:00:00+01:00",
    ]:
        assert opening_status(teresa["opening_hours"], datetime.fromisoformat(value)) is False
    delibes = indexed["Mediateca Miguel Delibes"]
    assert (
        opening_status(
            delibes["opening_hours"], datetime.fromisoformat("2026-11-02T15:00:00+01:00")
        )
        is False
    )
    assert not any(delibes["historical_popularity"]["days"]["6"].values())
    chata = indexed["Biblioteca La Chata"]
    assert (
        opening_status(chata["opening_hours"], datetime.fromisoformat("2026-11-02T12:00:00+01:00"))
        is False
    )


def test_zone_inference_never_reuses_inferred_donors():
    rows, catalog = real_rows()
    profiles = {
        "Mediateca Miguel Delibes": {
            "zone": "test",
            "references": ["Centro Cultural Julio Cortázar"],
        }
    }
    with pytest.raises(ValueError, match="donante"):
        apply_zone_profiles(rows, catalog, profiles)


def test_seed_and_opening_sql_parse():
    sql = (ROOT / "supabase/migrations/202610310014_north_catalog.sql").read_text()
    assert parse_sql(sql) and parse_plpgsql(sql)
    assert parse_sql((ROOT / "tests/north_catalog_smoke.sql").read_text())


def test_distance_weighting_and_closed_donor_exclusion():
    def row(name, value):
        return {
            "id": name,
            "name": name,
            "opening_hours": {"weekly": {str(d): [["09:00", "21:00"]] for d in range(1, 8)}},
            "historical_popularity": {
                "days": {str(d): {f"{h:02}": value for h in range(6, 24)} for d in range(1, 8)}
            },
        }

    rows = [row("target", None), row("near", 20), row("far", 80)]
    rows[2]["opening_hours"]["weekly"]["6"] = []
    catalog = [
        {"id": name, "lat": 40.4, "lng": lng}
        for name, lng in [("target", -3.7025), ("near", -3.7), ("far", -3.71)]
    ]
    apply_zone_profiles(rows, catalog, {"target": {"zone": "test", "references": ["near", "far"]}})
    assert rows[0]["historical_popularity"]["days"]["1"]["12"] == pytest.approx(35, abs=0.001)
    assert rows[0]["historical_popularity"]["days"]["6"]["12"] == 20
