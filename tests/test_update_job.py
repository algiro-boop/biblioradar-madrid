import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from test_engine import weather_payload
from test_scrapers import LIBRARY, NOW, OPEN_9_21, google_page

from biblioradar.engine import HEURISTIC_SOURCE, MADRID
from biblioradar.update_job import (
    BASE_VALID_MINUTES,
    base_valid_until,
    credentials,
    opening_status,
    published_weekend_status,
    read_libraries,
    run_job,
)


@pytest.mark.parametrize("dry_run", [True, False])
def test_job_is_atomic_and_never_overwrites_fusion(dry_run):
    writes = []

    def database(request):
        assert request.headers["apikey"] == "server-secret"
        if request.method == "GET":
            return httpx.Response(
                200, json=[LIBRARY] if request.url.params["offset"] == "0" else []
            )
        writes.append(json.loads(request.content))
        assert request.url.path == "/rest/v1/rpc/update_occupancy_bases"
        return httpx.Response(200, json=1)

    def sources(request):
        assert "apikey" not in request.headers and "Authorization" not in request.headers
        if request.url.host == "api.open-meteo.com":
            return httpx.Response(200, json=weather_payload(1))
        return httpx.Response(200, text=google_page(None, 60))

    with (
        httpx.Client(transport=httpx.MockTransport(database)) as db,
        httpx.Client(transport=httpx.MockTransport(sources)) as source,
    ):
        rows = run_job(
            db,
            source,
            "https://example.supabase.co",
            {"apikey": "server-secret"},
            now=NOW,
            dry_run=dry_run,
        )
    assert rows[0]["predicted_base_pct"] == 66
    assert "final_occupancy_pct" not in rows[0] and "crowd_pct" not in rows[0]
    assert len(writes) == (0 if dry_run else 1)
    if not dry_run:
        assert writes == [{"p_updates": rows}]


def test_pagination_respects_server_page_cap():
    def handler(request):
        offset = int(request.url.params["offset"])
        return httpx.Response(200, json=[{"id": offset}] if offset < 3 else [])

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert len(read_libraries(client, "https://example.org", {})) == 3


def test_source_failures_fall_back_to_hourly_estimate_and_still_refresh_crowd():
    writes = []

    def database(request):
        if request.method == "GET":
            return httpx.Response(
                200, json=[LIBRARY] if request.url.params["offset"] == "0" else []
            )
        writes.append(json.loads(request.content))
        return httpx.Response(200, json=1)

    with (
        httpx.Client(transport=httpx.MockTransport(database)) as db,
        httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(404))) as sources,
    ):
        rows = run_job(db, sources, "https://example.org", {}, now=NOW)
    # Viernes 14:00 Madrid, horario desconocido: curva horaria (45) con el ajuste estable del
    # centro (-4 puntos en punta, 45 * (1 - 4/62) = 42), nunca 0 ni NULL en horario hábil.
    assert rows[0]["predicted_base_pct"] == 42
    assert rows[0]["base_source"] == f"{HEURISTIC_SOURCE} · clima no disponible"
    assert rows[0]["google_live_pct"] is None and rows[0]["google_hist_pct"] is None
    assert len(writes) == 1


def run_with_google(page, now=NOW, library=LIBRARY):
    def database(request):
        return httpx.Response(200, json=[library] if request.url.params["offset"] == "0" else [])

    def sources(request):
        if request.url.host == "api.open-meteo.com":
            return httpx.Response(200, json=weather_payload())
        return httpx.Response(200, text=page)

    with (
        httpx.Client(transport=httpx.MockTransport(database)) as db,
        httpx.Client(transport=httpx.MockTransport(sources)) as source,
    ):
        return run_job(db, source, "https://example.org", {}, now=now, dry_run=True)


def test_google_without_popularity_uses_hourly_estimate():
    rows = run_with_google(google_page(None, None, hours=OPEN_9_21))
    assert rows[0]["predicted_base_pct"] == 42
    assert rows[0]["base_source"] == HEURISTIC_SOURCE


def test_google_hours_closed_means_no_estimate():
    rows = run_with_google(google_page(None, None, hours=[["Cerrado"]]))
    assert rows[0]["predicted_base_pct"] is None
    assert rows[0]["base_source"] == "Cerrada según horario de Google"


def test_reviewed_hours_override_google():
    library = {
        **LIBRARY,
        "opening_hours": {"requires_review": False, "weekly": {"5": [["09:00", "21:00"]]}},
    }
    rows = run_with_google(google_page(None, None, hours=[["Cerrado"]]), library=library)
    assert rows[0]["predicted_base_pct"] == 42


def test_unknown_hours_at_night_stay_unknown():
    night = NOW.replace(hour=21)  # 23:00 Madrid
    rows = run_with_google(google_page(None, None), now=night)
    assert rows[0]["predicted_base_pct"] is None
    assert rows[0]["base_source"] == "Sin datos de concurrencia"


def test_weather_failure_is_marked_for_historical_estimate():
    def database(request):
        return httpx.Response(200, json=[LIBRARY] if request.url.params["offset"] == "0" else [])

    def sources(request):
        return (
            httpx.Response(404)
            if request.url.host == "api.open-meteo.com"
            else httpx.Response(200, text=google_page(None, 60))
        )

    with (
        httpx.Client(transport=httpx.MockTransport(database)) as db,
        httpx.Client(transport=httpx.MockTransport(sources)) as source,
    ):
        rows = run_job(db, source, "https://example.org", {}, now=NOW, dry_run=True)
    assert rows[0]["predicted_base_pct"] == 60
    assert "clima no disponible" in rows[0]["base_source"]


def test_closed_library_skips_scraper_but_updates_aggregate():
    library = {
        **LIBRARY,
        "opening_hours": {"requires_review": False, "weekly": {str(d): [] for d in range(1, 8)}},
    }

    def database(request):
        return httpx.Response(200, json=[library] if request.url.params["offset"] == "0" else [])

    def sources(request):
        assert request.url.host == "api.open-meteo.com"
        return httpx.Response(200, json=weather_payload())

    with (
        httpx.Client(transport=httpx.MockTransport(database)) as db,
        httpx.Client(transport=httpx.MockTransport(sources)) as source,
    ):
        rows = run_job(db, source, "https://example.org", {}, now=NOW, dry_run=True)
    assert rows[0]["base_source"] == "Cerrada según horario revisado"
    assert rows[0]["predicted_base_pct"] is None


def test_opening_times_overrides_and_overnight():
    hours = {
        "requires_review": False,
        "timezone": "Europe/Madrid",
        "weekly": {str(d): [["09:00", "21:00"]] for d in range(1, 8)},
    }
    assert opening_status(hours, NOW) is True
    assert opening_status(hours, NOW.replace(hour=19)) is False  # 21:00 Madrid
    hours["date_overrides"] = {"2026-10-23": []}
    assert opening_status(hours, NOW) is False
    hours["date_overrides"] = {}
    hours["weekly"]["4"] = [["22:00", "02:00"]]
    assert opening_status(hours, NOW.replace(hour=23) - timedelta(days=1)) is True
    assert opening_status({"requires_review": True}, NOW) is None
    hours["weekly"]["5"] = [["25:00", "26:00"]]
    assert opening_status(hours, NOW) is None


def test_dst_elapsed_minutes_are_utc():
    from zoneinfo import ZoneInfo

    from biblioradar.engine import Report, fuse

    madrid = ZoneInfo("Europe/Madrid")
    before = datetime(2026, 10, 25, 2, 30, tzinfo=madrid, fold=0)
    after = datetime(2026, 10, 25, 2, 30, tzinfo=madrid, fold=1)
    result = fuse(50, [Report(30, before)], after)
    utc_result = fuse(
        50, [Report(30, before.astimezone(timezone.utc))], after.astimezone(timezone.utc)
    )
    assert result == utc_result
    assert result.crowd_confidence < 0.1


@pytest.mark.parametrize(
    "url", ["http://example.org", "https://example.org/path", "https://u:p@example.org"]
)
def test_credentials_reject_bad_origins(monkeypatch, url):
    monkeypatch.setenv("SUPABASE_URL", url)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-key")
    with pytest.raises(ValueError):
        credentials()


SATURDAY = datetime(2026, 10, 24, 10, tzinfo=timezone.utc)  # sábado 12:00 Madrid
SUNDAY = SATURDAY + timedelta(days=1)  # domingo 11:00 Madrid (horario de invierno)
COMUNIDAD_SAT = (
    "Apertura de lunes a sábado.  De lunes a viernes de 9 a 21 horas. Sábados de 9 a 14 horas. "
    "Todos los días los servicios de lectura en sala finalizarán 15 minutos antes del cierre. "
    "Días de cierre: sábados: 4 de abril, 1 de agosto."
)


@pytest.mark.parametrize(
    "text,when,expected",
    [
        (COMUNIDAD_SAT, SATURDAY, True),
        (COMUNIDAD_SAT, SATURDAY.replace(hour=13), False),  # 15:00, ya cerró a las 14
        (COMUNIDAD_SAT, SUNDAY, False),
        # "Todos los días" referido a servicios no abre el fin de semana.
        (
            "Apertura de lunes a viernes. De lunes a viernes de 9 a 21 horas. Todos los días "
            "los servicios finalizarán 15 minutos antes del cierre.",
            SATURDAY,
            False,
        ),
        (
            "Apertura de lunes a domingo. Fines de semana y festivos, de 11 a 19 horas.",
            SUNDAY,
            True,
        ),
        (
            "Horario: lunes a viernes de 8:30 a 21, sábado y domingo de 8:30 a 15. Verano "
            "(15 jun a 15 sept): lunes a viernes de 8:30 a 20, sábado y domingo de 8:30 a 14.",
            SATURDAY.replace(hour=12),  # 14:00: abierta en invierno (hasta 15)
            True,
        ),
        ("De lunes a domingo, de 9 a 14 y de 15 a 21 horas.", SUNDAY, True),
        ("De lunes a domingo, de 9 a 14 y de 15 a 21 horas.", SUNDAY.replace(hour=13), False),
        ("Abierto todos los días de 8 a 22 horas.", SUNDAY, True),
        ("Sábados, domingos y festivos de 10:00 a 21:00 horas.", SATURDAY, True),
        (
            "De lunes a sábado, de 9 a 22 horas. Domingos, festivos y agosto cerrado.",
            SATURDAY,
            True,
        ),
        ("De lunes a sábado, de 9 a 22 horas. Domingos, festivos y agosto cerrado.", SUNDAY, False),
        (
            "De lunes a domingo, 9 a 21 horas. Cerrado: sábados, domingos, festivos y agosto.",
            SATURDAY,
            False,
        ),
        ("Sábados abierto.", SATURDAY, True),  # día abierto, horas desconocidas: franja 8:30-21
        ("Sábados abierto.", SATURDAY.replace(hour=20), None),
        ("De lunes a viernes de 9 a 21 horas.", SATURDAY, None),
        ("Julio: sábados de 9 a 14 horas.", SATURDAY, None),
        ("Consultar telefónicamente", SATURDAY, None),
        (COMUNIDAD_SAT, NOW, None),  # entre semana no se usa
    ],
)
def test_published_weekend_status(text, when, expected):
    hours = {"requires_review": True, "normalized_text": text, "raw_text": text}
    assert published_weekend_status(hours, when) is expected


def test_weekend_estimate_uses_published_text_and_district():
    library = {
        **LIBRARY,
        "institution": "comunidad",
        "district": "Retiro",
        "opening_hours": {"requires_review": True, "normalized_text": COMUNIDAD_SAT},
    }
    rows = run_with_google(google_page(None, None), now=SATURDAY, library=library)
    # Sábado 12:00: curva 62, +13 puntos (Comunidad fin de semana 12, Retiro 5, estable -4),
    # x0.75 por sábado fuera de exámenes = 56.
    assert rows[0]["predicted_base_pct"] == 56
    assert rows[0]["base_source"].startswith(HEURISTIC_SOURCE)  # clima simulado es del viernes
    closed = run_with_google(google_page(None, None), now=SUNDAY, library=library)
    assert closed[0]["predicted_base_pct"] is None
    assert closed[0]["base_source"] == "Cerrada según horario publicado"


def test_read_libraries_selects_district_for_context():
    def handler(request):
        assert "district" in request.url.params["select"].split(",")
        return httpx.Response(200, json=[])

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        read_libraries(client, "https://example.org", {})


def valid_until(rows):
    return datetime.fromisoformat(rows[0]["base_valid_until"]).astimezone(MADRID)


def test_closed_snapshot_expires_exactly_at_google_opening():
    before_opening = datetime(2026, 10, 23, 6, 45, tzinfo=timezone.utc)  # 08:45 Madrid
    rows = run_with_google(google_page(None, None, hours=OPEN_9_21), now=before_opening)
    assert rows[0]["base_source"] == "Cerrada según horario de Google"
    assert valid_until(rows) == datetime(2026, 10, 23, 9, tzinfo=MADRID)


def test_open_snapshot_expires_at_closing_or_after_margin():
    evening = datetime(2026, 10, 23, 18, 30, 20, tzinfo=timezone.utc)  # 20:30:20 Madrid
    rows = run_with_google(google_page(None, None), now=evening)  # franja por defecto
    assert rows[0]["predicted_base_pct"] is not None
    assert valid_until(rows) == datetime(2026, 10, 23, 21, tzinfo=MADRID)
    rows = run_with_google(google_page(None, None, hours=OPEN_9_21))  # 14:00, sin cambios
    assert valid_until(rows) - NOW.astimezone(MADRID) == timedelta(minutes=BASE_VALID_MINUTES)


@pytest.mark.parametrize(
    "now,opening",
    [
        # Sábado 24-10-2026 en horario de verano (CEST, UTC+2) y domingo 25 tras el cambio a
        # invierno (CET, UTC+1): la apertura de las 09:00 locales cae en otra hora UTC.
        (datetime(2026, 10, 24, 6, 0, tzinfo=timezone.utc), datetime(2026, 10, 24, 7, 0)),
        (datetime(2026, 10, 25, 7, 0, tzinfo=timezone.utc), datetime(2026, 10, 25, 8, 0)),
    ],
)
def test_reviewed_opening_uses_madrid_time_across_dst(now, opening):
    library = {
        **LIBRARY,
        "opening_hours": {
            "requires_review": False,
            "weekly": {
                **{str(day): [["09:00", "21:00"]] for day in range(1, 6)},
                "6": [["09:00", "14:00"]],
                "7": [["09:00", "14:00"]],
            },
        },
    }
    rows = run_with_google(google_page(None, None), now=now, library=library)
    assert rows[0]["base_source"] == "Cerrada según horario revisado"
    assert datetime.fromisoformat(rows[0]["base_valid_until"]) == opening.replace(
        tzinfo=timezone.utc
    )


def test_base_valid_until_never_exceeds_margin():
    now = datetime(2026, 10, 23, 10, 0, 30, tzinfo=timezone.utc)
    assert base_valid_until(now, lambda _: True) == now + timedelta(minutes=BASE_VALID_MINUTES)
    flip = now.replace(second=0) + timedelta(minutes=7)
    assert base_valid_until(now, lambda when: when < flip) == flip
