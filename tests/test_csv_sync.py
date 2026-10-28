"""Validación del CSV maestro sin servicios externos ni dependencias pesadas en CI."""

import csv
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from pglast import parse_sql

from biblioradar import csv_job

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("csv_sync", ROOT / "sync_csv_to_supabase.py")
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("8:30–14:30 / 16:00–21:00", [["08:30", "14:30"], ["16:00", "21:00"]]),
        ("Cerrado", []),
        ("", None),
        ("9:00–24:00", [["09:00", "24:00"]]),
    ],
)
def test_hours(raw, expected):
    assert sync.parse_hours(raw) == expected


@pytest.mark.parametrize(
    "raw", ["25:00–26:00", "10:60–12:00", "22:00–06:00", "texto", "9:00–12:00 / 11:00–15:00"]
)
def test_invalid_hours(raw):
    with pytest.raises(ValueError):
        sync.parse_hours(raw)


def row():
    data = dict.fromkeys(sync.COLUMNS, "")
    data.update(nombre="Biblioteca Prueba", num_resenas="123", valoracion="4,5")
    for day in sync.DAYS:
        data[f"horario_{day}"] = "9:00–14:00 / 16:00–21:00"
    return data


def test_interpolation_only_isolated_open_points():
    data = row()
    for hour, value in {9: "20", 11: "60", 12: "70", 16: "80", 19: "90"}.items():
        data[f"ocupacion_lun_{hour:02}"] = value
    curve = sync.clean_curve(data, "lun", sync.parse_hours(data["horario_lun"]))
    assert curve[10 - 6] == 40
    assert curve[17 - 6 : 19 - 6] == [None, None]
    assert curve[14 - 6 : 16 - 6] == [0, 0]
    assert curve[6 - 6] == 0
    assert sync.clean_curve(data, "lun", []) == [0] * 18
    assert sync.clean_curve(data, "lun", None) == [None] * 18


def test_no_interpolation_across_lunch_break():
    data = row()
    data["ocupacion_lun_13"] = "60"
    data["ocupacion_lun_16"] = "90"
    curve = sync.clean_curve(data, "lun", sync.parse_hours(data["horario_lun"]))
    assert curve[14 - 6 : 16 - 6] == [0, 0]


@pytest.mark.parametrize("value", ["inf", "-1", "101"])
def test_invalid_curve_is_rejected_even_when_closed(value):
    data = row()
    data["ocupacion_lun_06"] = value
    with pytest.raises(ValueError):
        sync.prepare([data], expected_rows=1)


def test_schema_counts_and_duplicate_names():
    with pytest.raises(ValueError):
        sync.prepare([row()])
    with pytest.raises(ValueError):
        sync.prepare([row(), row()], expected_rows=2)
    data = row()
    del data["telefono"]
    with pytest.raises(ValueError):
        sync.prepare([data], expected_rows=1)


def test_matching_preserves_ids_ambiguity_requires_override():
    rows = sync.prepare([row()], expected_rows=1)
    id1, id2 = str(uuid4()), str(uuid4())
    catalog = [
        {"id": id, "name": "Biblioteca Prueba", "lat": 40.4, "lng": -3.7} for id in [id1, id2]
    ]
    matched, problems = sync.match_catalog(rows, catalog, {})
    assert not matched and len(problems) == 1
    matched, problems = sync.match_catalog(rows, catalog, {"Biblioteca Prueba": id2})
    assert matched[0]["id"] == id2 and not problems
    assert "lat" not in matched[0]  # El RPC no sobrescribe coordenadas existentes.


def test_real_csv_and_verified_matches():
    with (ROOT / "data/csv/bibliotecas_madrid_popular_times.csv").open(newline="") as f:
        prepared = sync.prepare(list(csv.DictReader(f)))
    assert len(prepared) == 88
    assert all(len(r["historical_popularity"]["days"]) == 7 for r in prepared)
    elipa = next(r for r in prepared if "La Elipa" in r["name"])
    assert elipa["opening_hours"]["requires_review"] is False
    for day in map(str, range(1, 6)):
        assert elipa["opening_hours"]["weekly"][day] == [["08:30", "21:00"]]
        points = elipa["historical_popularity"]["days"][day]
        assert all(points[f"{hour:02}"] == 0.0 for hour in [6, 7, 21, 22, 23])
        assert any(points[f"{hour:02}"] is not None for hour in range(8, 21))
    assert elipa["historical_popularity"]["days"]["1"]["12"] == 100
    assert elipa["historical_popularity"]["days"]["3"]["14"] == 74  # NaN aislado.
    for day in ["6", "7"]:
        assert elipa["opening_hours"]["weekly"][day] == []
        assert all(v == 0.0 for v in elipa["historical_popularity"]["days"][day].values())
    assert len(json.loads((ROOT / "data/csv/verified_locations.json").read_text())) == 3


def test_migration_and_smoke_parse():
    for path in [
        ROOT / "supabase/migrations/202610280005_csv_bayesian.sql",
        ROOT / "tests/csv_bayesian_smoke.sql",
    ]:
        assert parse_sql(path.read_text())


def test_csv_cron_uses_rpc_and_dry_run(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-test")
    client_class = httpx.Client
    calls = []

    def handle(request):
        calls.append(request)
        assert request.url.path == "/rest/v1/rpc/refresh_csv_occupancy"
        assert json.loads(request.content) == {"p_dry_run": True}
        assert request.headers["apikey"] == "server-test"
        return httpx.Response(200, json={"libraries": 88, "dry_run": True})

    monkeypatch.setattr(
        csv_job.httpx,
        "Client",
        lambda **kw: client_class(transport=httpx.MockTransport(handle), **kw),
    )
    assert csv_job.main(["--dry-run"]) == 0
    assert len(calls) == 1


def test_csv_cron_invalid_origin_does_not_send_credentials(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.com/evil")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    assert csv_job.main([]) == 1
