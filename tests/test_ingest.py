import copy
import json

import httpx
import pytest
from pglast import parse_sql

from biblioradar.ingest import (
    DATASETS,
    KOS,
    SOURCE,
    STUDY_ROOMS_SOURCE,
    canonical_district,
    classify_institution,
    main,
    normalize,
    parse_json,
    prepare,
    prepare_all,
    request_with_retry,
    upsert,
)


@pytest.fixture
def record():
    return {
        "id": "1757",
        "title": "Biblioteca Pública Municipal Aluche (Latina)",
        "@id": "https://datos.madrid.es/egob/catalogo/1757.json",
        "address": {
            "street-address": " CALLE  CAMARENA 10 ",
            "district": {"@id": "https://datos.madrid.es/Distrito/SanBlas-Canillejas"},
        },
        "location": {"latitude": "40,4", "longitude": -3.7},
        "organization": {"schedule": "<p>Lunes &amp; viernes: 9 a 21.</p>\u00a0Festivos: cerrado."},
    }


def test_normalize_preserves_provenance_and_unknowns(record):
    row = normalize(record, {})
    assert row["source"] == SOURCE
    assert row["source_id"] == "1757"
    assert row["district"] == "San Blas-Canillejas"
    assert row["lat"] == 40.4
    assert row["address"] == "CALLE CAMARENA 10"
    assert row["institution"] == "ayuntamiento"
    hours = row["opening_hours"]
    assert hours["raw_text"] == record["organization"]["schedule"]
    assert hours["normalized_text"] == "Lunes & viernes: 9 a 21. Festivos: cerrado."
    assert hours["weekly"] is None and hours["requires_review"]
    assert "google_place_id" not in row and "total_seats" not in row and "id" not in row


@pytest.mark.parametrize(
    "lat,lng",
    [(None, -3.7), (float("nan"), -3.7), (float("inf"), -3.7), (-3.7, 40.4), (4400000, 430000)],
)
def test_bad_coordinates(record, lat, lng):
    record["location"] = {"latitude": lat, "longitude": lng}
    with pytest.raises(ValueError):
        normalize(record, {})


def test_scope_and_explicit_institution(record):
    regional = copy.deepcopy(record)
    regional.update(id="25526", title="Biblioteca Pública Antonio Mingote")
    payload = {"@graph": [record, regional]}
    assert len(prepare(payload, "municipal", {})[0]) == 1
    rows, errors = prepare(payload, "all", {})
    # "Biblioteca Pública X" sin "Municipal" pertenece a la red de la Comunidad.
    assert not errors and rows[1]["institution"] == "comunidad"
    assert prepare(payload, "all", {"25526": "otra"})[0][1]["institution"] == "otra"


def test_duplicate_and_invalid_rows_are_reported(record):
    rows, errors = prepare({"@graph": [record, record, {"title": "sin id"}]}, "all", {})
    assert len(rows) == 1 and len(errors) == 2


@pytest.mark.parametrize("payload", [{}, {"@graph": []}, [], {"@graph": [{"id": "x"}]}])
def test_empty_or_changed_schema_fails(payload):
    with pytest.raises(ValueError):
        prepare(payload, "municipal", {})


def test_postgrest_atomic_upsert_payload(record):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(201)

    rows = [normalize(record, {})]
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        upsert(rows, "https://example.supabase.co", "test-server-key", client)
    request = requests[0]
    assert request.url.params["on_conflict"] == "source,source_id"
    assert request.headers["Prefer"] == "resolution=merge-duplicates,return=minimal"
    assert json.loads(request.content) == rows


def test_transient_retry_and_permanent_failure(monkeypatch):
    monkeypatch.setattr("biblioradar.ingest.time.sleep", lambda _: None)
    codes = iter([503, 429, 200])
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(next(codes)))
    ) as client:
        assert request_with_retry(client, "GET", "https://example.org").status_code == 200
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(401)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            request_with_retry(client, "GET", "https://example.org")
    assert len(calls) == 1


def test_cli_dry_run_and_strict_failure(record, tmp_path):
    source = tmp_path / "source.json"
    output = tmp_path / "normalized.json"
    source.write_text(json.dumps({"@graph": [record]}))
    assert main(["--input", str(source), "--dry-run", "--output", str(output)]) == 0
    assert len(json.loads(output.read_text())) == 1
    source.write_text(json.dumps({"@graph": [record, {"id": "bad"}]}))
    assert main(["--input", str(source), "--dry-run"]) == 1
    assert main(["--input", str(source), "--dry-run", "--allow-skips"]) == 0


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Biblioteca Pública Municipal Aluche (Latina)", "ayuntamiento"),
        ("Biblioteca Pública Municipal José Hierro (San Blas-Canillejas)", "ayuntamiento"),
        ("Biblioteca Pública José Hierro (Usera)", "comunidad"),
        ("Biblioteca Pública Pedro Salinas (Centro)", "comunidad"),
        ("Biblioteca Pública del Estado Manuel Alvar  (Salamanca)", "comunidad"),
        ("Centro Cultural Paco Rabal. Biblioteca Pública (Puente de Vallecas)", "comunidad"),
        ("Sala de estudio Fernando Vizcaíno Casas (Chamberí)", "ayuntamiento"),
        ("Sala de estudio del Centro Cultural Galileo (Chamberí)", "ayuntamiento"),
        ("Sala de Lectura León Felipe", "ayuntamiento"),
        ("Aula de estudio de Manoteras. Sala de estudio (Hortaleza)", "ayuntamiento"),
        ("Centro Cultural San Juan Bautista (Ciudad Lineal)", "ayuntamiento"),
    ],
)
def test_institution_classification(name, expected):
    assert classify_institution(name, "", "") == expected


def test_classification_fallbacks():
    # Sin palabras clave: el catálogo de salas es municipal; madrid.es sin señales de Comunidad.
    assert classify_institution("Plaza Lugar Poetas", KOS + "SalasEstudioLectura", "") == (
        "ayuntamiento"
    )
    assert classify_institution("Espacio X", "", "https://datos.madrid.es/x.json") == (
        "ayuntamiento"
    )
    assert classify_institution("Espacio X", "", "https://example.org/x.json") == "otra"
    assert classify_institution("Espacio X", "", "https://madrid.es.example.org/") == "otra"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("PuenteDeVallecas", "Puente de Vallecas"),
        ("Chamberi", "Chamberí"),
        ("San Blas - Canillejas", "San Blas-Canillejas"),
        ("Fuencarral-ElPardo", "Fuencarral-El Pardo"),
        ("Distrito", None),
    ],
)
def test_canonical_district(raw, expected):
    assert canonical_district(raw) == expected


def study_room(record_id, title, district="Chamberi", record_type="SalasEstudioLectura"):
    return {
        "@id": f"https://datos.madrid.es/egob/catalogo/tipo/entidadesyorganismos/{record_id}.json",
        "@type": KOS + record_type,
        "id": record_id,
        "title": title,
        "address": {
            "street-address": "CALLE BLASCO DE GARAY 40",
            "district": {
                "@id": f"https://datos.madrid.es/egob/kos/Provincia/Madrid/Municipio/Madrid/Distrito/{district}"
            }
            if district
            else None,
        },
        "location": {"latitude": 40.4338, "longitude": -3.7114},
        "organization": {"schedule": "De lunes a domingo, de 9 a 14 y de 15 a 21 horas."},
    }


def test_study_rooms_catalog_is_included_and_normalized():
    payload = {
        "@graph": [
            study_room("5753557", "Sala de estudio Fernando Vizcaíno Casas (Chamberí)"),
            study_room("11681766", "Sala de estudio del Centro Cultural Galileo (Chamberí)"),
            # Distrito roto en el origen: se toma del título.
            study_room("12684456", "Sala de estudios Casita del Reloj (Salamanca)", "Distrito"),
            study_room("10751094", "Sala de estudio Motilla del Palancar (Hortaleza)", None),
            # Las oficinas de información juvenil comparten catálogo, pero no son salas.
            study_room(
                "12383033", "Centro de Ocio Juvenil", record_type="OficinasInformacionJuvenil"
            ),
        ]
    }
    rows, errors = prepare(payload, "municipal", {}, DATASETS["salas"])
    assert not errors
    by_name = {row["name"]: row for row in rows}
    assert set(by_name) == {
        "Sala de estudio Fernando Vizcaíno Casas (Chamberí)",
        "Sala de estudio del Centro Cultural Galileo (Chamberí)",
        "Sala de estudios Casita del Reloj (Salamanca)",
        "Sala de estudio Motilla del Palancar (Hortaleza)",
    }
    galileo = by_name["Sala de estudio del Centro Cultural Galileo (Chamberí)"]
    assert galileo["source"] == STUDY_ROOMS_SOURCE and galileo["source_id"] == "11681766"
    assert galileo["institution"] == "ayuntamiento" and galileo["district"] == "Chamberí"
    assert by_name["Sala de estudios Casita del Reloj (Salamanca)"]["district"] == "Salamanca"
    assert by_name["Sala de estudio Motilla del Palancar (Hortaleza)"]["district"] == "Hortaleza"


def test_both_catalogs_combine_and_overrides_accept_source_prefix(record):
    salas = {"@graph": [study_room("1757", "Sala de estudio Fernando Vizcaíno Casas (Chamberí)")]}
    payloads = [(DATASETS["bibliotecas"], {"@graph": [record]}), (DATASETS["salas"], salas)]
    rows, errors = prepare_all(payloads, "all", {f"{STUDY_ROOMS_SOURCE}:1757": "otra"})
    # El mismo id en catálogos distintos no colisiona: la clave única es (source, source_id).
    assert not errors and [(r["source"], r["institution"]) for r in rows] == [
        (SOURCE, "ayuntamiento"),
        (STUDY_ROOMS_SOURCE, "otra"),
    ]


def test_parse_json_tolerates_raw_newlines():
    raw = '\ufeff{"@graph": [{"title": "Centro\nIntergeneracional"}]}'.encode()
    assert parse_json(raw)["@graph"][0]["title"] == "Centro\nIntergeneracional"


def test_cli_reads_both_local_catalogs(record, tmp_path):
    libraries = tmp_path / "bibliotecas.json"
    rooms = tmp_path / "salas.json"
    output = tmp_path / "normalized.json"
    libraries.write_text(json.dumps({"@graph": [record]}))
    # Salto de línea sin escapar, como en el JSON oficial de salas.
    rooms.write_text(
        json.dumps({"@graph": [study_room("5753557", "Sala de estudio XYZ (Chamberí)")]}).replace(
            "XYZ", "Fernando\nVizcaíno"
        )
    )
    argv = ["--input", f"bibliotecas={libraries}", "--input", f"salas={rooms}"]
    assert main([*argv, "--scope", "all", "--dry-run", "--output", str(output)]) == 0
    rows = json.loads(output.read_text())
    assert [row["source"] for row in rows] == [SOURCE, STUDY_ROOMS_SOURCE]
    assert rows[1]["name"] == "Sala de estudio Fernando Vizcaíno (Chamberí)"
    assert main(["--input", str(libraries), "--input", str(libraries), "--dry-run"]) == 1


def test_sql_parses():
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "supabase/migrations/202610230001_phase1.sql"
    assert len(parse_sql(path.read_text())) > 30
