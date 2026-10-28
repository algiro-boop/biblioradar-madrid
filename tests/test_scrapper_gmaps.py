import importlib.util
import json
import sys
from pathlib import Path

import httpx
import pytest

# El script es autónomo: PEP 723 permite uv run sin modificar dependencias del proyecto.
SPEC = importlib.util.spec_from_file_location(
    "scrapper_gmaps", Path(__file__).parents[1] / "scrapper_gmaps.py"
)
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


@pytest.mark.parametrize(
    "label,hour,usual,live",
    [
        ("65% busy at 12 PM.", 12, 65, None),
        ("Usually 60% busy at 3 PM. Currently 30% busy.", 15, 60, 30),
        ("0% busy at 12 AM.", 0, 0, None),
        ("Currently 80% busy, usually 45% busy at 3 PM.", 15, 45, 80),
        ("Live: 0% busy. Usually 30% busy at 9 AM.", 9, 30, 0),
        ("Actualmente: 80 % de concurrencia; lo habitual es un 45 % a las 15:00.", 15, 45, 80),
        ("25 % de concurrencia a las 9:00.", 9, 25, None),
        ("Currently 40% busy, usually 30% busy.", None, 30, 40),
    ],
)
def test_parse_accessible_values(label, hour, usual, live):
    assert module.parse_bar(label) == module.Bar(hour, usual, live)


@pytest.mark.parametrize(
    "label",
    [
        "Currently not too busy",
        "80% of reviews are positive",
        "Usually busy",
        "101% busy at 9 AM",
        "10% busy at 25:00",
        "40% busy at 3:30 PM",
        "20% busy at 0 AM",
        "20% busy at 13 PM",
    ],
)
def test_missing_or_invalid_is_not_zero(label):
    assert module.parse_bar(label) is None


def test_daily_conflicts_and_explicit_zero():
    hours, live = module.daily_values(
        [
            "0% busy at 8 AM",
            "40% busy at 9 AM",
            "50% busy at 9 AM",
            "Currently 60% busy",
            "Currently 60% busy",
        ]
    )
    assert len(hours) == 24 and hours[8] == 0 and hours[9] is None and hours[10] is None
    assert live == 60
    assert module.daily_values(["Currently 40% busy", "Currently 50% busy"])[1] is None


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Monday", 1),
        ("miércoles", 3),
        ("Sunday, 26 October", 7),
        ("Popular times", None),
        ("", None),
    ],
)
def test_weekdays(value, expected):
    assert module.weekday(value) == expected


@pytest.mark.parametrize(
    "url",
    [
        "http://www.google.com/maps/place/Test",
        "https://evil.test/maps",
        "https://www.google.com.evil.test/maps",
        "https://user:secret@www.google.com/maps",
        "https://www.google.com:444/maps",
        "https://www.google.com/search",
        None,
    ],
)
def test_bad_navigation_targets(url):
    with pytest.raises(ValueError):
        module.valid_maps_url(url)


@pytest.mark.parametrize(
    "url", ["https://www.google.com/maps/place/Test", "https://maps.app.goo.gl/Test"]
)
def test_valid_navigation_targets(url):
    assert module.valid_maps_url(url) == url


def test_pagination_includes_required_columns():
    requests = []

    def handler(request):
        requests.append(request)
        assert request.headers["apikey"] == "test-key"
        assert "google_maps_url" in request.url.params["select"]
        return httpx.Response(
            200, json=[{"id": "row"}] if request.url.params["offset"] == "0" else []
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert module.Supabase(client, "https://test.supabase.co", "test-key").libraries() == [
            {"id": "row"}
        ]
    assert len(requests) == 2


def test_missing_schema_is_actionable():
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(400))) as client:
        with pytest.raises(ValueError, match="google_maps_url"):
            module.Supabase(client, "https://test.supabase.co", "key").libraries()


def test_persistence_does_not_touch_consolidated_occupancy(monkeypatch):
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    requests = []
    reading = {
        "id": "reading-uuid",
        "library_id": "library-uuid",
        "live_value": 0,
        "usual_value": 30,
        "created_at": "2026-10-27T12:00:00+00:00",
        "historical_popularity": {"days": {}, "complete": True},
    }

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(503)
        if request.url.path.endswith("occupancy_status"):
            body = json.loads(request.content)
            assert set(body) == {"google_live_busyness", "google_usual_busyness", "last_scraped_at"}
            assert body["google_live_busyness"] == 0
            return httpx.Response(200, json=[{"library_id": "library-uuid"}])
        return httpx.Response(204)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        module.Supabase(client, "https://test.supabase.co", "key").persist(reading)
    assert requests[0].content == requests[1].content  # UUID estable al reintentar.
    assert requests[1].headers["Prefer"].startswith("resolution=ignore-duplicates")
    assert requests[-1].url.params["historical_popularity"] == "is.null"


def test_no_snapshot_row_is_not_silent_success():
    def handler(request):
        return httpx.Response(200, json=[]) if request.method == "PATCH" else httpx.Response(204)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="fila única"):
            module.Supabase(client, "https://test.supabase.co", "key").persist(
                {
                    "id": "reading",
                    "library_id": "lib",
                    "live_value": None,
                    "usual_value": None,
                    "created_at": "date",
                    "historical_popularity": None,
                }
            )


def test_dry_run_writes_local_reading_but_not_database(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    lib_id = "00000000-0000-0000-0000-000000000001"
    monkeypatch.setattr(module.Supabase, "libraries", lambda _: [{"id": lib_id, "name": "Test"}])

    def forbidden(*args):
        raise AssertionError("dry-run no debe escribir en Supabase")

    monkeypatch.setattr(module.Supabase, "persist", forbidden)
    closed = []

    class Browser:
        def __init__(self, *args):
            pass

        def read(self, library, collect_week):
            assert collect_week
            return {"library_id": lib_id, "live_value": 0, "usual_value": None}

        def close(self):
            closed.append(True)

    monkeypatch.setattr(module, "VisibleMaps", Browser)
    output = tmp_path / "result.jsonl"
    assert (
        module.main(["--dry-run", "--profile", str(tmp_path / "profile"), "--output", str(output)])
        == 0
    )
    assert json.loads(output.read_text())["live_value"] == 0 and closed == [True]


def test_skip_missing_graph_does_not_write_to_supabase(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    ids = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]
    monkeypatch.setattr(
        module.Supabase, "libraries", lambda _: [{"id": id, "name": "Test"} for id in ids]
    )
    persisted = []
    monkeypatch.setattr(module.Supabase, "persist", lambda _, reading: persisted.append(reading))

    class Browser:
        def __init__(self, *args):
            pass

        def read(self, library, collect_week):
            if library["id"] == ids[0]:
                raise module.NoPopularityData("Sin gráfica")
            return {"library_id": library["id"], "live_value": 0, "usual_value": 30}

        def close(self):
            pass

    monkeypatch.setattr(module, "VisibleMaps", Browser)
    output = tmp_path / "readings.jsonl"
    assert module.main(["--profile", str(tmp_path / "profile"), "--output", str(output)]) == 0
    rows = [json.loads(line) for line in output.read_text().splitlines()]
    assert rows[0]["status"] == "skipped"
    assert len(persisted) == 1 and persisted[0]["library_id"] == ids[1]
    assert persisted[0]["live_value"] == 0


def test_no_graph_is_distinct_from_broken_selector():
    from types import SimpleNamespace

    browser = module.VisibleMaps.__new__(module.VisibleMaps)
    browser.by = SimpleNamespace(CSS_SELECTOR="css")
    browser.driver = SimpleNamespace(find_elements=lambda *args: [])
    browser.labels = lambda: []
    with pytest.raises(module.NoPopularityData):
        browser.control()
    browser.labels = lambda: ["50% busy at 9 AM"]
    with pytest.raises(ValueError, match="selector"):
        browser.control()
