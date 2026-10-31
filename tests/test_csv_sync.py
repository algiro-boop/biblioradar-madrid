"""Validación del CSV maestro sin servicios externos ni dependencias pesadas en CI."""

import csv
import importlib.util
import json
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from pglast import parse_sql

from biblioradar import csv_job
from biblioradar.update_job import opening_status

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
    assert len(prepared) == 105
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
    assert len(json.loads((ROOT / "data/csv/verified_locations.json").read_text())) == 18


def test_six_additions_have_complete_reference_curves_and_distinct_ids():
    with (ROOT / "data/csv/bibliotecas_madrid_popular_times.csv").open(newline="") as f:
        raw = list(csv.DictReader(f))
    rows = sync.prepare(raw)
    provenance = json.loads((ROOT / "data/csv/curve_provenance.json").read_text())
    assert sum(p["kind"] == "reference_estimate" for p in provenance.values()) == 6
    sync.apply_curve_provenance(rows, provenance)
    by_name = {r["name"]: r for r in rows}
    for name in (n for n, p in provenance.items() if p["kind"] == "reference_estimate"):
        library = by_name[name]
        assert library["opening_hours"]["requires_review"] is False
        assert library["historical_popularity"]["provenance"]["kind"] == "reference_estimate"
        for day in range(1, 8):
            slots = library["opening_hours"]["weekly"][str(day)]
            points = library["historical_popularity"]["days"][str(day)]
            for hour in range(6, 24):
                value = points[f"{hour:02}"]
                assert value is not None and 0 <= value <= 100
                if not any(
                    (hour + 1) * 60 > sync.minute(a) and hour * 60 < sync.minute(b)
                    for a, b in slots
                ):
                    assert value == 0
        if "Hacienda de Pavones" not in name:
            assert library["opening_hours"]["weekly"]["6"] == []
            assert library["opening_hours"]["weekly"]["7"] == []
    gloria = next(r for r in raw if r["nombre"] == "Biblioteca Gloria Fuertes (Rivas)")
    monday = float(
        (sum(Decimal(gloria[f"ocupacion_{d}_12"]) for d in sync.DAYS[1:5]) / 4).quantize(
            Decimal("0.1"), rounding=ROUND_HALF_UP
        )
    )
    for name in [
        "Biblioteca Federico García Lorca (Rivas)",
        "Biblioteca José Saramago (Rivas)",
        "Biblioteca Almudena Grandes (Rivas)",
    ]:
        curve = by_name[name]["historical_popularity"]["days"]
        assert curve["1"]["12"] == monday
        assert curve["2"]["12"] == float(gloria["ocupacion_mar_12"])
    base = by_name["Centro Sociocultural Moratalaz"]
    pavones = by_name["Sala de Estudio Hacienda de Pavones (Moratalaz)"]
    assert pavones["opening_hours"]["weekly"] == base["opening_hours"]["weekly"]
    assert abs(
        pavones["historical_popularity"]["days"]["1"]["12"]
        - base["historical_popularity"]["days"]["1"]["12"]
    ) in (2, 3)
    overrides = json.loads((ROOT / "data/csv/name_matches.json").read_text())
    assert (
        overrides["Biblioteca Pública Municipal Francisco Ayala"]
        == "c81bb808-9d4a-4189-ade8-791c12e837d5"
    )
    assert (
        overrides["Biblioteca Pública Municipal José Saramago"]
        != overrides["Biblioteca José Saramago (Rivas)"]
    )


def test_catalog_count_guard_and_explicit_future_expansion():
    records = [{**row(), "nombre": f"Biblioteca {i}"} for i in range(106)]
    with pytest.raises(ValueError):
        sync.prepare(records)
    assert len(sync.prepare(records, expected_rows=106)) == 106
    with pytest.raises(ValueError):
        sync.prepare(records[:88])  # Un CSV truncado no debe archivar seis centros por accidente.


def test_julio_and_fortuna_archetypes_have_low_precision_and_exact_schedules():
    with (ROOT / "data/csv/bibliotecas_madrid_popular_times.csv").open(newline="") as f:
        rows = sync.prepare(list(csv.DictReader(f)))
    provenance = json.loads((ROOT / "data/csv/curve_provenance.json").read_text())
    sync.apply_curve_provenance(rows, provenance)
    by_name = {r["name"]: r for r in rows}
    julio = by_name["Centro Cultural Julio Cortázar"]
    fortuna = by_name["Biblioteca Enrique Tierno Galván (La Fortuna)"]
    for library in [julio, fortuna]:
        assert library["historical_popularity"]["provenance"]["kind"] == "archetype"
        assert library["historical_popularity"]["provenance"]["kappa"] == 6
        assert not library["opening_hours"]["requires_review"]
        for day in map(str, range(1, 8)):
            slots = library["opening_hours"]["weekly"][day]
            for hour, value in library["historical_popularity"]["days"][day].items():
                assert value is not None and 0 <= value <= 100
                opened = any(
                    (int(hour) + 1) * 60 > sync.minute(a) and int(hour) * 60 < sync.minute(b)
                    for a, b in slots
                )
                assert (value > 0) == opened
    assert all(v == [["09:00", "21:00"]] for v in julio["opening_hours"]["weekly"].values())
    for day in map(str, range(1, 6)):
        assert fortuna["opening_hours"]["weekly"][day] == [["15:00", "21:00"]]
    for day in ["6", "7"]:
        assert fortuna["opening_hours"]["weekly"][day] == [["10:30", "19:30"]]
    for time, expected in [("10:29", False), ("10:30", True), ("19:29", True), ("19:30", False)]:
        assert (
            opening_status(
                fortuna["opening_hours"], datetime.fromisoformat(f"2026-10-31T{time}+01:00")
            )
            is expected
        )
    mappings = json.loads((ROOT / "data/csv/name_matches.json").read_text())
    assert mappings[julio["name"]] == "8721aec8-df5d-4c86-9562-78601e7045d9"
    location = json.loads((ROOT / "data/csv/verified_locations.json").read_text())[fortuna["name"]]
    assert (location["lat"], location["lng"], location["institution"]) == (
        40.35824,
        -3.78453,
        "otra",
    )
    assert location["source_url"].startswith("https://www.leganes.org/")
    assert "[" not in location["source_url"]


@pytest.mark.parametrize("precision", [None, 0, 8, "6", True])
def test_archetypes_require_explicit_kappa_six(precision):
    with pytest.raises(ValueError):
        sync.apply_curve_provenance(
            sync.prepare([row()], expected_rows=1),
            {
                "Biblioteca Prueba": {
                    "kind": "archetype",
                    "kappa": precision,
                    "method": "Perfil genérico",
                }
            },
        )


def gloria_source():
    with (ROOT / "data/csv/sources/centro_cultural_gloria_fuertes.csv").open(
        encoding="utf-8-sig", newline=""
    ) as f:
        return list(csv.DictReader(f))


def test_barajas_curve_matches_every_supplied_hour_and_weekends_are_closed():
    imported = sync.import_long_popularity(gloria_source())
    with (ROOT / "data/csv/bibliotecas_madrid_popular_times.csv").open(newline="") as f:
        raw = list(csv.DictReader(f))
    barajas = next(r for r in raw if r["nombre"] == "Centro Cultural Gloria Fuertes (Barajas)")
    for key in [c for c in sync.COLUMNS if c.startswith(("ocupacion_", "horario_"))]:
        assert barajas[key] == imported[key]
    assert barajas["direccion"] == "Av. de Logroño, 179, Barajas, 28042 Madrid"
    assert barajas["ocupacion_lun_07"] == "33"
    assert all(barajas[f"horario_{day}"] == "07:30–22:00" for day in sync.DAYS[:5])
    assert all(
        barajas[f"ocupacion_{day}_{hour:02}"] == "0"
        for day in ["sab", "dom"]
        for hour in range(6, 24)
    )
    rivas = next(r for r in raw if r["nombre"] == "Biblioteca Gloria Fuertes (Rivas)")
    assert rivas["direccion"] == "C. Jovellanos, 30, 28522 Rivas-Vaciamadrid, Madrid"
    assert rivas["telefono"] == "913 22 23 95"
    assert rivas["horario_mar"] == "9:00–21:00"
    assert rivas["horario_lun"] == "Cerrado"
    hours = sync.prepare([barajas], expected_rows=1)[0]["opening_hours"]
    for time, expected in [("07:29", False), ("07:30", True), ("21:59", True), ("22:00", False)]:
        assert (
            opening_status(hours, datetime.fromisoformat(f"2026-10-28T{time}:00+01:00")) is expected
        )
    assert opening_status(hours, datetime.fromisoformat("2026-10-31T12:00:00+01:00")) is False


@pytest.mark.parametrize(
    "problem",
    [
        "missing_hour",
        "duplicate_hour",
        "missing_day",
        "bad_day",
        "bad_pct",
        "closed_pct",
        "bad_address",
    ],
)
def test_long_csv_rejects_incomplete_or_inconsistent_data(problem):
    rows = gloria_source()
    if problem == "missing_hour":
        rows.pop(0)
    elif problem == "duplicate_hour":
        rows.append(dict(rows[0]))
    elif problem == "missing_day":
        rows = [r for r in rows if r["dia"] != "domingo"]
    elif problem == "bad_day":
        rows[0]["dia"] = "festivo"
    elif problem == "bad_pct":
        rows[0]["ocupacion_pct"] = "101"
    elif problem == "closed_pct":
        rows[0]["ocupacion_pct"] = "1"  # 06:00 aún cerrado.
    elif problem == "bad_address":
        rows[0]["direccion"] = "Otra ubicación"
    with pytest.raises(ValueError):
        sync.import_long_popularity(rows)


def test_gloria_homonyms_use_physical_ids_and_do_not_duplicate_on_resync():
    barajas_id = "15e27271-a7ab-4cfb-a65a-9ab63e4e8d6c"
    rivas_id = "f9500e30-9722-5aa7-b781-5fd22bf82ebe"
    mappings = json.loads((ROOT / "data/csv/name_matches.json").read_text())
    locations = json.loads((ROOT / "data/csv/verified_locations.json").read_text())
    rivas_name, barajas_name = (
        "Biblioteca Gloria Fuertes (Rivas)",
        "Centro Cultural Gloria Fuertes (Barajas)",
    )
    assert mappings[rivas_name] == rivas_id and mappings[barajas_name] == barajas_id
    # El nombre erróneo anterior no debe impedir un alta explícita con otro UUID.
    original = [
        {
            "id": barajas_id,
            "name": "Biblioteca Gloria Fuertes",
            "lat": 40.460559472287,
            "lng": -3.59374618117853,
        }
    ]
    expanded, new_ids = sync.expand_catalog(original, {rivas_name: locations[rivas_name]}, mappings)
    assert new_ids == {rivas_id}
    assert expanded[0] == original[0]
    assert expanded[1]["district"] == "Rivas-Vaciamadrid"
    assert expanded[1]["lat"] == 40.3493674 and expanded[1]["lng"] == -3.5264018
    rows = [{"name": name, "direccion": ""} for name in [rivas_name, barajas_name]]
    resolved, problems = sync.match_catalog(rows, expanded, mappings)
    assert not problems and [r["id"] for r in resolved] == [rivas_id, barajas_id]
    assert sync.expand_catalog(expanded, {rivas_name: locations[rivas_name]}, mappings) == (
        expanded,
        set(),
    )


@pytest.mark.parametrize(
    "source",
    [
        [],
        {"Desconocida": {}},
        {
            "Biblioteca Prueba": {
                "kind": "reference_estimate",
                "references": ["Ausente"],
                "method": "media",
            }
        },
    ],
)
def test_invalid_curve_provenance(source):
    with pytest.raises(ValueError):
        sync.apply_curve_provenance(sync.prepare([row()], expected_rows=1), source)


def test_pablo_neruda_closure_and_november_3_reopening():
    with (ROOT / "data/csv/bibliotecas_madrid_popular_times.csv").open(newline="") as f:
        rows = sync.prepare(list(csv.DictReader(f)))
    library = next(r for r in rows if r["name"] == "Biblioteca Pública Municipal Pablo Neruda")
    original_weekly = json.dumps(library["opening_hours"]["weekly"])
    original_curve = json.dumps(library["historical_popularity"])
    sync.apply_opening_exceptions(
        rows, json.loads((ROOT / "data/csv/opening_exceptions.json").read_text())
    )
    hours = library["opening_hours"]
    assert json.dumps(hours["weekly"]) == original_weekly
    assert json.dumps(library["historical_popularity"]) == original_curve
    for day in ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]:
        assert hours["date_overrides"][day] == []
        assert opening_status(hours, datetime.fromisoformat(day + "T12:00:00+01:00")) is False
    assert "2026-11-03" not in hours["date_overrides"]
    for time, expected in [("08:29", False), ("08:30", True), ("20:59", True), ("21:00", False)]:
        assert (
            opening_status(hours, datetime.fromisoformat(f"2026-11-03T{time}:00+01:00")) is expected
        )
    assert all(not r["opening_hours"]["date_overrides"] for r in rows if r is not library)


@pytest.mark.parametrize(
    "exceptions",
    [
        [],
        {"Desconocida": {}},
        {"Biblioteca Prueba": []},
        {"Biblioteca Prueba": {"2026-02-30": []}},
        {"Biblioteca Prueba": {"2026-11-02": None}},
        {"Biblioteca Prueba": {"2026-11-02": [["21:00", "09:00"]]}},
        {"Biblioteca Prueba": {"2026-11-02": [["09:00"]]}},
        {"Biblioteca Prueba": {"2026-11-02": [[9, "10:00"]]}},
    ],
)
def test_invalid_opening_exceptions(exceptions):
    with pytest.raises(ValueError):
        sync.apply_opening_exceptions(sync.prepare([row()], expected_rows=1), exceptions)


def test_opening_exceptions_can_replace_hours_without_changing_other_dates():
    rows = sync.prepare([row()], expected_rows=1)
    rows[0]["opening_hours"]["date_overrides"]["2026-11-01"] = []
    sync.apply_opening_exceptions(rows, {"Biblioteca Prueba": {"2026-11-02": [["9:00", "13:00"]]}})
    assert rows[0]["opening_hours"]["date_overrides"] == {
        "2026-11-01": [],
        "2026-11-02": [["09:00", "13:00"]],
    }


def test_migration_and_smoke_parse():
    for path in [
        ROOT / "supabase/migrations/202610280005_csv_bayesian.sql",
        ROOT / "supabase/migrations/202610280007_occupancy_cron.sql",
        ROOT / "supabase/migrations/202610280008_catalog_expansion.sql",
        ROOT / "supabase/migrations/202610290009_archetype_precision.sql",
        ROOT / "tests/archetype_smoke.sql",
        ROOT / "tests/occupancy_cron_smoke.sql",
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
        return httpx.Response(200, json={"libraries": 97, "dry_run": True})

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
