import json
from datetime import datetime, timezone

import httpx
import pytest

from biblioradar.scrapers import (
    clean_query,
    get_google,
    get_observation,
    get_ucm,
    is_week,
    name_score,
    parse_google,
    parse_open_now,
    popularity,
)

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)  # viernes 14:00 Madrid
LIBRARY = {
    "id": "00000000-0000-0000-0000-000000000001",
    "name": "Biblioteca Aluche",
    "address": "Calle Camarena",
    "lat": 40.4,
    "lng": -3.7,
    "institution": "ayuntamiento",
    "google_place_id": "ChIJtest",
}


def google_week(hist=60):
    """Gráfica semanal (día ISO, [[hora, %, texto...]]); hoy es viernes (5) a las 14:00."""
    friday = ([[14, hist, "Normalmente bastante concurrido"]] if hist is not None else []) + [
        [15, 20]
    ]
    return [[1, None], [2, None], [3, None], [4, None], [5, friday], [6, [[14, 99]]], [7, None]]


def google_place(live=0, hist=60, place_id="ChIJtest", lat=40.4, name=None, hours=None, index=84):
    place = [None] * 260
    place[9] = [None, None, lat, -3.7]
    place[11] = name or LIBRARY["name"]
    place[78] = place_id
    if live is not None or hist is not None:
        place[index] = [google_week(hist)] + [None] * 6 + [["Ahora: muy concurrido", live]]
    if hours is not None:
        # Formato observado en 2026: [nombre, día ISO, [año, mes, día], [[texto, [[h, m], [h]]]]].
        place[203] = [[["viernes", 5, [2026, 10, 23], hours, 0, 1]]]
    return place


def google_page(live=0, hist=60, place_id="ChIJtest", lat=40.4, name=None, hours=None, places=None):
    places = places or [google_place(live, hist, place_id, lat, name, hours)]
    # Google incluye JSON XSSI anidado dentro de APP_INITIALIZATION_STATE.
    return (
        "<script>window.APP_INITIALIZATION_STATE="
        + json.dumps([None, ")]}'\n" + json.dumps(places)])
        + ";</script>"
    )


OPEN_9_21 = [["9:00–21:00", [[9], [21]]]]


def test_google_zero_live_and_local_historical_hour():
    def handler(request):
        assert request.url.params["q"] == "place_id:ChIJtest"
        assert "Authorization" not in request.headers
        return httpx.Response(200, text=google_page())

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = get_google(client, LIBRARY, NOW)
    assert result.google_live_pct == 0 and result.google_hist_pct == 60


def test_google_search_by_name_and_coordinates():
    library = {**LIBRARY, "google_place_id": None}

    def handler(request):
        assert "Biblioteca Aluche" in request.url.params["q"]
        assert request.url.params["ll"] == "40.4,-3.7"
        return httpx.Response(200, text=google_page())

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert get_google(client, library, NOW).google_hist_pct == 60


@pytest.mark.parametrize(
    "page",
    [
        "Consent required",
        "APP_INITIALIZATION_STATE=broken",
        google_page(place_id="wrong"),
        google_page(lat=41),
    ],
)
def test_google_failures_do_not_invent_zero(page):
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=page))
    ) as client:
        result = get_google(client, LIBRARY, NOW)
    assert result.error and not result.available


def test_missing_google_hist_is_not_zero():
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=google_page(None, None)))
    ) as client:
        result = get_google(client, LIBRARY, NOW)
    assert result.google_hist_pct is None and result.google_live_pct is None


WIDGET = """<script>var login='public_user'; var ticket='ephemeral';
var urlCurl='https://engine3.sitesandstats.com/url_interface.php';
refreshPlacement(urlCurl,'7553');</script>"""
UCM = {**LIBRARY, "name": "Biblioteca María Zambrano", "institution": "ucm"}


def test_ucm_real_widget_contract():
    def handler(request):
        assert "Authorization" not in request.headers
        if request.method == "GET":
            return httpx.Response(200, text=WIDGET)
        data = json.loads(request.content)
        assert data["ticket"] == "ephemeral" and data["ids"] == "7553" and data["day"] == "1"
        assert request.url.host == "engine3.sitesandstats.com"
        return httpx.Response(
            200,
            json={
                "status": "OK",
                "json": {
                    "id": 7553,
                    "name": "Biblioteca María Zambrano",
                    "flowTpc": 0,
                    "hours": [{"flowTpc": 99}],  # No usar predicciones como aforo actual.
                },
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = get_observation(client, UCM, NOW)
    assert result.university_live_pct == 0 and result.google_live_pct is None


def test_ucm_unknown_and_failed_widget():
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(404))) as client:
        assert not get_ucm(client, UCM).available
        assert not get_ucm(client, {**UCM, "name": "Otra biblioteca UCM"}).available
        assert not get_observation(client, UCM, NOW).available


def test_google_network_failure(monkeypatch):
    monkeypatch.setattr("biblioradar.ingest.time.sleep", lambda _: None)

    def handler(request):
        raise httpx.ConnectError("sin red", request=request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert get_google(client, LIBRARY, NOW).error


def test_google_search_json_envelope_and_district_suffix():
    page = google_page()
    state, _ = json.JSONDecoder().raw_decode(page.split("APP_INITIALIZATION_STATE=")[1])
    response = json.dumps({"c": 0, "d": state[1]}) + "/* streaming trailer */"
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=response))
    ) as client:
        result = get_google(client, LIBRARY, NOW)
    assert result.google_hist_pct == 60
    from biblioradar.scrapers import place_name

    assert place_name("Biblioteca Aluche (Latina)") == place_name("Biblioteca Aluche")


def test_ucm_rejects_changed_provider_without_contacting_it():
    urls = []

    def handler(request):
        urls.append(str(request.url))
        return httpx.Response(
            200, text=WIDGET.replace("engine3.sitesandstats.com", "untrusted.example")
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = get_ucm(client, UCM)
    assert result.error and len(urls) == 1


def test_clean_query_strips_administrative_suffixes():
    library = {
        "name": "Biblioteca Pública Municipal Miguel Delibes (Moratalaz)",
        "address": "CALLE ARROYO BELINCOSO 11 JUNTO A CENTRO CULTURAL EDUARDO CHILLIDA",
    }
    assert clean_query(library) == (
        "Biblioteca Pública Municipal Miguel Delibes CALLE ARROYO BELINCOSO 11 Madrid"
    )
    for address, expected in [
        ("AVENIDA GLORIETAS 19 EN C. CULTURAL POZO TIO RAIMUNDO", "AVENIDA GLORIETAS 19"),
        ("PLAZA DONOSO 5 En el Centro Cultural Eduardo Úrculo", "PLAZA DONOSO 5"),
        ("PLAZA PUEBLO 2 CENTRO CULTURAL ORCASUR", "PLAZA PUEBLO 2"),
        ("CALLE FUENTE DEL TIRO 72 PLANTA 1.ª", "CALLE FUENTE DEL TIRO 72"),
        ("CALLE BRONCE, 16 (Entrada por la calle Sodio, 16)", "CALLE BRONCE, 16"),
        ("CALLE GENERAL RICARDOS 252 Antiguo Mercado de Carabanchel", "CALLE GENERAL RICARDOS 252"),
        ("CALLE CENTRO 3", "CALLE CENTRO 3"),
    ]:
        assert clean_query({"name": "X", "address": address}) == f"X {expected} Madrid"


@pytest.mark.parametrize(
    "wanted,candidate,matches",
    [
        ("Biblioteca Pública Municipal Iván de Vargas (Centro)", "Biblioteca Iván de Vargas", True),
        (
            "Sala de estudio Fernando Vizcaíno Casas (Chamberí)",
            "Sala de Estudio Fernando Vizcaíno Casas",
            True,
        ),
        (
            "Biblioteca Pública Municipal Benito Pérez Galdós (Centro)",
            "Biblioteca Municipal Benito Pérez Galdós - Conde Duque",
            True,
        ),
        # Maps nombra el edificio que contiene la sala.
        (
            "Sala de estudio del Centro Cultural Galileo (Chamberí)",
            "Centro Cultural Municipal Galileo",
            True,
        ),
        ("Sala de estudio Galileo", "Centro Cultural Galileo", False),
        # Un lugar cercano que no es un centro de estudio no se asocia aunque comparta nombre.
        ("Sala de estudio San Cristóbal", "Parroquia San Cristóbal", False),
        # Solo palabras genéricas o una palabra corta en común: no identifica el centro.
        ("Biblioteca Pública Municipal Aluche (Latina)", "Biblioteca Pública Municipal", False),
        ("Sala de estudio Río Esmeralda", "Biblioteca Río Tajo", False),
        ("Biblioteca Pública Municipal Aluche (Latina)", "Biblioteca Ana María Matute", False),
    ],
)
def test_relaxed_name_matching(wanted, candidate, matches):
    assert (name_score(wanted, candidate) > 0) is matches


def test_relaxed_match_without_place_id_within_300m():
    library = {
        **LIBRARY,
        "google_place_id": None,
        "name": "Biblioteca Pública Municipal Aluche (Latina)",
    }
    page = google_page(name="Biblioteca Aluche", lat=40.4025)  # ~280 m al norte
    assert parse_google(page, library, NOW).google_hist_pct == 60
    with pytest.raises(ValueError):
        parse_google(google_page(name="Biblioteca Aluche", lat=40.403), library, NOW)  # ~330 m


def test_exact_name_beats_partial_and_ties_are_rejected():
    library = {**LIBRARY, "google_place_id": None, "name": "Biblioteca Aluche"}
    exact = google_place(hist=60, place_id="a", name="Biblioteca Aluche")
    partial = google_place(hist=10, place_id="b", name="Biblioteca Aluche Infantil")
    page = google_page(places=[partial, exact])
    assert parse_google(page, library, NOW).google_hist_pct == 60
    twin = google_place(hist=10, place_id="c", name="Biblioteca Aluche")
    with pytest.raises(ValueError):
        parse_google(google_page(places=[exact, twin]), library, NOW)


@pytest.mark.parametrize(
    "hours,expected",
    [
        (OPEN_9_21, True),  # 14:00 Madrid
        ([["9:00–14:00", [[9], [14]]], ["15:00–21:00", [[15], [21]]]], False),
        ([["8:30–14:30", [[8, 30], [14, 30]]]], True),
        ([["Cerrado"]], False),
        ([["Abierto 24 horas", [[0], [24]]]], True),
        ([["Horario especial"]], None),
    ],
)
def test_google_structured_opening_hours(hours, expected):
    page = google_page(None, None, hours=hours)
    assert parse_google(page, LIBRARY, NOW).open_now is expected
    # Otro día distinto del de hoy: no se deduce nada.
    assert parse_open_now(google_place(hours=hours), NOW.replace(day=24)) is None


def test_without_popularity_tries_place_page_and_keeps_hours():
    queries = []

    def handler(request):
        queries.append((request.url.path, request.url.params["q"]))
        if request.url.path == "/search":
            return httpx.Response(200, text=google_page(None, None, hours=OPEN_9_21))
        return httpx.Response(200, text="<html>consent.google.com</html>")

    library = {**LIBRARY, "google_place_id": None}
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = get_google(client, library, NOW)
    assert queries == [
        ("/search", "Biblioteca Aluche Calle Camarena Madrid"),
        ("/maps", "place_id:ChIJtest"),
    ]
    assert result.open_now is True and result.place_id == "ChIJtest"
    assert not result.available and result.error is None


def test_place_page_popularity_is_merged_with_search_hours():
    def handler(request):
        if request.url.path == "/search":
            return httpx.Response(200, text=google_page(None, None, hours=OPEN_9_21))
        return httpx.Response(200, text=google_page(live=None, hist=70))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = get_google(client, LIBRARY, NOW)
    assert result.google_hist_pct == 70 and result.open_now is True


def test_google_requests_carry_eu_consent_and_spanish_locale():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, text=google_page())

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        get_google(client, LIBRARY, NOW)
    request = seen[0]
    assert request.url.host == "www.google.com"
    assert request.headers["Accept-Language"] == "es-ES,es;q=0.9"
    assert (
        request.headers["Cookie"] == "SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVzIAEaBgiAo_CmBg"
    )
    # La cookie va por petición: el cliente compartido no la envía a otras fuentes.
    assert not client.cookies


@pytest.mark.parametrize("index", [84, 120, 251])
def test_popularity_found_wherever_google_moves_it(index):
    place = google_place(live=35, hist=60, index=index)
    result = parse_google(google_page(places=[place]), LIBRARY, NOW)
    assert (result.google_live_pct, result.google_hist_pct) == (35, 60)


def test_popularity_week_without_container_block():
    place = google_place(None, None)
    place[230] = [None, [None, google_week(45)]]
    week, live = popularity(place)
    assert week == google_week(45) and live is None
    assert parse_google(google_page(places=[place]), LIBRARY, NOW).google_hist_pct == 45


def test_invalid_live_value_is_ignored_not_zero():
    result = parse_google(google_page(live=101, hist=60), LIBRARY, NOW)
    assert result.google_live_pct is None and result.google_hist_pct == 60


@pytest.mark.parametrize(
    "value,expected",
    [
        (google_week(60), True),
        (google_week(60)[:6], False),  # semana incompleta
        ([[d, None] for d in range(1, 8)], False),  # sin ninguna hora
        ([[1, [[24, 10]]]] + google_week()[1:], False),  # hora imposible
        ([[1, [[9, 140]]]] + google_week()[1:], False),  # porcentaje imposible
        ([[1, [[9, 10]]]] * 7, False),  # días repetidos
        # Listas de iconos o categorías con pares de enteros pequeños no son una semana.
        ([[3, 12], [4, 40], [5, 1], [6, 2], [7, 8], [1, 0], [2, 9]], False),
    ],
)
def test_week_shape_detector(value, expected):
    assert is_week(value) is expected


def test_place_preview_json_is_used_when_maps_page_has_no_chart():
    paths = []
    preview = "/maps/preview/place?authuser=0&hl=es&pb=%211m14%211s0xd42"

    def handler(request):
        paths.append(request.url.path)
        if request.url.path == "/search":
            return httpx.Response(200, text=google_page(None, None, hours=OPEN_9_21))
        if request.url.path == "/maps":
            body = google_page(None, None) + f'<a href="{preview.replace("&", "&amp;")}">'
            return httpx.Response(200, text=body)
        assert request.url.params["pb"] == "!1m14!1s0xd42" and request.url.params["hl"] == "es"
        return httpx.Response(200, text=")]}'\n" + json.dumps([None, google_place(None, 55)]))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = get_google(client, LIBRARY, NOW)
    assert paths == ["/search", "/maps", "/maps/preview/place"]
    assert result.google_hist_pct == 55 and result.open_now is True


def test_consent_redirect_is_a_failure_not_data():
    def handler(request):
        if request.url.host == "consent.google.com":
            return httpx.Response(200, text=google_page())  # nunca se acepta como dato
        return httpx.Response(302, headers={"Location": "https://consent.google.com/ml?continue=x"})

    with httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True) as client:
        result = get_google(client, LIBRARY, NOW)
    assert result.error == "Google no disponible: ValueError" and not result.available
