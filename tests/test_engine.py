from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import httpx
import pytest
from pglast import parse_sql

from biblioradar.engine import (
    HEURISTIC_CAP,
    MADRID,
    Report,
    fuse,
    heuristic_base,
    is_exam_period,
    library_points,
    predict_base,
)
from biblioradar.ingest import DATASETS, KOS, normalize
from biblioradar.weather import get_weather

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "day,expected",
    [
        ("2026-11-14", False),
        ("2026-11-15", True),
        ("2026-12-31", True),
        ("2027-01-01", True),
        ("2027-01-31", True),
        ("2027-02-01", False),
        ("2026-04-24", False),
        ("2026-04-25", True),
        ("2026-06-30", True),
        ("2026-07-01", False),
        ("2028-02-29", False),
    ],
)
def test_exam_boundaries(day, expected):
    assert is_exam_period(date.fromisoformat(day)) is expected


def test_calendar_uses_madrid_midnight():
    assert is_exam_period(datetime(2026, 11, 14, 23, 30, tzinfo=timezone.utc))
    assert not is_exam_period(datetime(2027, 1, 31, 23, 30, tzinfo=timezone.utc))


@pytest.mark.parametrize(
    "live,hist,day,rain,expected",
    [
        (0, 90, "2026-12-01", True, 0),
        (42, 90, "2026-12-01", True, 42),
        (None, 50, "2026-10-23", False, 50),
        (None, 50, "2026-10-23", True, 55),
        (None, 50, "2026-12-01", False, 63),
        (None, 50, "2026-12-01", True, 69),
        (None, 99, "2026-12-01", True, 100),
        (None, None, "2026-12-01", True, None),
    ],
)
def test_base(live, hist, day, rain, expected):
    assert predict_base(live, hist, date.fromisoformat(day), rain) == expected


@pytest.mark.parametrize("bad", [-1, 101, True, 1.5, float("nan"), "30"])
def test_invalid_percentages(bad):
    with pytest.raises(ValueError):
        predict_base(bad, 30, NOW, False)


def test_aware_dates_required():
    with pytest.raises(ValueError):
        is_exam_period(datetime(2026, 11, 15))
    with pytest.raises(ValueError):
        fuse(50, [], datetime(2026, 1, 1))
    with pytest.raises(ValueError):
        fuse(50, [Report(30, datetime(2026, 1, 1))], NOW)


def test_empty_unknown_and_no_base():
    assert fuse(None, [], NOW).final_occupancy_pct is None
    assert fuse(80, [], NOW).final_occupancy_pct == 80
    result = fuse(None, [Report(75, NOW)], NOW)
    assert result.final_occupancy_pct == result.crowd_pct == 75
    assert result.crowd_confidence == Decimal("0.35")


def test_half_up_rounding_differs_from_python_bankers_round():
    result = fuse(80, [Report(30, NOW)], NOW)
    assert result.final_occupancy_pct == 63  # 62.5, igual que round(numeric) PostgreSQL.
    assert result.crowd_pct == 30 and result.active_reports_count == 1


def test_exponential_weights_and_confidence_cap():
    reports = [Report(30, NOW), Report(100, NOW - timedelta(minutes=45))]
    result = fuse(80, reports, NOW)
    weight = Decimal(-1).exp()
    mean = (Decimal(30) + 100 * weight) / (1 + weight)
    conf = (1 + weight) * Decimal("0.35")
    assert abs(result.crowd_confidence - conf) < Decimal("1e-25")
    assert result.crowd_pct == int(mean.quantize(Decimal(1), rounding="ROUND_HALF_UP"))
    capped = fuse(80, [Report(30, NOW - timedelta(minutes=1))] * 20, NOW)
    assert capped.crowd_confidence == Decimal("0.85")
    assert capped.final_occupancy_pct == 38  # 37.5 exacto incluso con pesos irracionales.


def test_window_boundary_and_future_reports():
    result = fuse(
        80,
        [
            Report(30, NOW - timedelta(minutes=90)),
            Report(100, NOW - timedelta(minutes=90, microseconds=1)),
            Report(100, NOW + timedelta(microseconds=1)),
        ],
        NOW,
    )
    assert result.active_reports_count == 1 and result.crowd_pct == 30
    assert fuse(80, [Report(30, NOW - timedelta(minutes=91))], NOW).final_occupancy_pct == 80


@pytest.mark.parametrize("value", [0, 99, 101, True])
def test_invalid_report(value):
    with pytest.raises(ValueError):
        fuse(50, [Report(value, NOW)], NOW)


def weather_payload(rain=0, showers=0, observed="2026-10-23T12:00"):
    return {
        "current": {"time": observed, "rain": rain, "showers": showers},
        "current_units": {"rain": "mm", "showers": "mm"},
    }


@pytest.mark.parametrize("rain,showers,expected", [(0, 0, False), (0.2, 0, True), (0, 1, True)])
def test_weather(rain, showers, expected):
    def handler(request):
        assert request.url.params["latitude"] == "40.4168"
        assert request.url.params["current"] == "rain,showers"
        assert "apikey" not in request.headers
        return httpx.Response(200, json=weather_payload(rain, showers))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert get_weather(client, NOW).is_raining is expected


@pytest.mark.parametrize(
    "payload",
    [
        {},
        weather_payload(rain=None),
        weather_payload(rain=-1),
        weather_payload(observed="2026-10-23T09:00"),
        weather_payload(observed="2026-10-24T12:00"),
    ],
)
def test_weather_unknown_is_not_silently_dry(payload):
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    ) as client:
        with pytest.raises(ValueError):
            get_weather(client, NOW)


def test_weather_retries(monkeypatch):
    monkeypatch.setattr("biblioradar.ingest.time.sleep", lambda _: None)
    attempts = iter([httpx.Response(503), httpx.Response(200, json=weather_payload(1))])
    with httpx.Client(transport=httpx.MockTransport(lambda _: next(attempts))) as client:
        assert get_weather(client, NOW).is_raining


def test_new_migration_parses():
    path = (
        Path(__file__).resolve().parents[1] / "supabase/migrations/202610230002_phase2_fusion.sql"
    )
    assert len(parse_sql(path.read_text())) >= 10


def madrid(day, hour, minute=0):
    return datetime.fromisoformat(f"{day}T{hour:02d}:{minute:02d}").replace(tzinfo=MADRID)


@pytest.mark.parametrize(
    "when,rain,open_now,expected",
    [
        (madrid("2026-10-23", 12), False, None, 62),  # viernes, pico de mañana
        (madrid("2026-10-23", 14), False, None, 45),  # valle de comida
        (madrid("2026-10-23", 18), False, None, 62),  # pico de tarde
        (madrid("2026-10-23", 20, 30), False, None, 38),
        (madrid("2026-10-23", 12), True, None, 68),  # lluvia x1.10
        (madrid("2026-12-01", 12), False, None, 78),  # exámenes x1.25
        (madrid("2026-12-01", 12), True, None, 85),
        (madrid("2026-10-23", 8), False, None, None),  # sin horario: antes de 8:30 no se estima
        (madrid("2026-10-23", 21), False, None, None),
        (madrid("2026-10-24", 12), False, None, None),  # sábado con horario desconocido
        (madrid("2026-10-24", 12), False, True, 47),  # sábado abierta (Google)
        (madrid("2026-10-25", 12), False, True, 40),  # domingo abierta
        (madrid("2026-12-05", 12), False, True, 74),  # sábado en exámenes
        (madrid("2026-10-23", 22), False, True, 12),  # sala abierta de noche
        (madrid("2026-10-23", 12), False, False, None),  # cerrada nunca estima
    ],
)
def test_heuristic_curve(when, rain, open_now, expected):
    assert heuristic_base(when, rain, open_now=open_now) == expected


def test_heuristic_never_zero_never_full():
    for hour in range(24):
        for day in ("2026-10-23", "2026-12-01", "2026-10-25"):
            value = heuristic_base(madrid(day, hour), True, open_now=True)
            assert value is not None and 1 <= value <= HEURISTIC_CAP < 100


def test_heuristic_uses_madrid_time_and_validates_input():
    # 10:00 UTC en octubre = 12:00 Madrid (CEST).
    assert (
        heuristic_base(datetime(2026, 10, 23, 10, tzinfo=timezone.utc), False, open_now=None) == 62
    )
    with pytest.raises(ValueError):
        heuristic_base(datetime(2026, 10, 23, 10), False, open_now=None)
    with pytest.raises(ValueError):
        heuristic_base(madrid("2026-10-23", 12), 1, open_now=None)


STUDY = {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "Biblioteca Aluche",
    "institution": "ayuntamiento",
    "district": "Latina",
}


def test_library_points_add_documented_factors():
    base = library_points(STUDY, weekend=False)
    assert base == library_points(STUDY, weekend=True) == -4  # solo la variación estable
    comunidad = {**STUDY, "institution": "comunidad"}
    assert library_points(comunidad, False) - base == 8
    assert library_points(comunidad, True) - base == 12
    assert library_points({**STUDY, "institution": "ucm"}, True) - base == 12
    for name in ("Sala de estudio Galileo (Chamberí)", "SALA DE LECTURA León Felipe"):
        assert library_points({**STUDY, "name": name}, False) - base == 6
    assert library_points({**STUDY, "name": "Centro Cultural Galileo"}, False) == base
    for district in ("Chamberí", "CHAMBERI", "Moncloa - Aravaca", "Ciudad Lineal"):
        assert library_points({**STUDY, "district": district}, False) - base == 5
    assert library_points({**STUDY, "district": "Villaverde"}, False) == base


def test_library_spread_is_stable_and_bounded():
    ids = [f"00000000-0000-0000-0000-{n:012d}" for n in range(300)]
    spread = [library_points({"id": i}, False) for i in ids]
    assert set(spread) == set(range(-7, 8))
    assert spread == [library_points({"id": i}, False) for i in ids]  # mismo valor cada hora


def test_heuristic_with_library_context():
    friday_noon = madrid("2026-10-23", 12)  # curva 62 = hora punta
    assert heuristic_base(friday_noon, False, open_now=None, library=STUDY) == 62 - 4
    big = {**STUDY, "institution": "comunidad", "district": "Retiro"}  # -4 + 8 + 5
    assert heuristic_base(friday_noon, False, open_now=None, library=big) == 62 + 9
    # Fuera de la hora punta los puntos se escalan con la curva: 45 * (1 + 9/62) = 51.5.
    assert heuristic_base(madrid("2026-10-23", 14), False, open_now=None, library=big) == 52
    saturday = madrid("2026-10-24", 12)  # -4 + 12 + 5 = 13 puntos; x0.75
    assert heuristic_base(saturday, False, open_now=True, library=big) == 56
    assert heuristic_base(saturday, False, open_now=None, library=big) is None
    assert heuristic_base(friday_noon, False, open_now=False, library=big) is None
    hot = {**big, "name": "Sala de estudio Retiro", "id": "x"}
    for hour in range(24):
        value = heuristic_base(madrid("2026-12-01", hour), True, open_now=True, library=hot)
        assert 1 <= value <= HEURISTIC_CAP


def synthetic_catalog() -> list[dict]:
    """Catálogo en memoria normalizado como en la importación (sin depender de data/)."""
    kinds = [
        ("bibliotecas", "BibliotecasPublicas", "Biblioteca Pública Municipal Autor {}"),
        ("bibliotecas", "BibliotecasPublicas", "Biblioteca Pública Autora {}"),
        ("salas", "SalasEstudioLectura", "Sala de estudio Centro Cultural {}"),
        ("salas", "SalasEstudioLectura", "Centro Sociocultural Barrio {}"),
    ]
    districts = ["Chamberi", "Latina", "Retiro", "Villaverde", "Moncloa-Aravaca", "Usera"]
    rows = []
    for n in range(96):
        key, kind, title = kinds[n % len(kinds)]
        district = districts[n // len(kinds) % len(districts)]
        record = {
            "@id": f"https://datos.madrid.es/egob/catalogo/{n}.json",
            "@type": KOS + kind,
            "id": str(1000 + n),
            "title": f"{title.format(n)} ({district})",
            "address": {
                "street-address": "CALLE MAYOR 1",
                "district": {
                    "@id": "https://datos.madrid.es/egob/kos/Provincia/Madrid/Municipio/Madrid/"
                    f"Distrito/{district}"
                },
            },
            "location": {"latitude": 40.4, "longitude": -3.7},
            "organization": {"schedule": "De lunes a viernes de 9 a 21 horas."},
        }
        row = normalize(record, {}, DATASETS[key])
        # PostgreSQL asigna un UUID estable a cada fila; aquí uno determinista.
        row["id"] = str(uuid5(NAMESPACE_URL, f"{row['source']}:{row['source_id']}"))
        rows.append(row)
    return rows


def test_catalog_is_no_longer_flat():
    rows = synthetic_catalog()
    assert {row["institution"] for row in rows} == {"ayuntamiento", "comunidad"}
    values = [
        heuristic_base(madrid("2026-10-23", 14), False, open_now=None, library=row) for row in rows
    ]
    # Curva 45 a las 14:00; los puntos (-7..+26) la escalan a 45 * (1 + p/62) = 40..64.
    assert len(set(values)) >= 12 and min(values) >= 40 and max(values) <= 64
