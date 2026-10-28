import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scrapper_gmaps_pruebas.py"
SPEC = importlib.util.spec_from_file_location("gmaps_independent", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


def test_copied_file_runs_offline_outside_project(tmp_path):
    copied = tmp_path / SCRIPT.name
    shutil.copyfile(SCRIPT, copied)
    labels = tmp_path / "labels.json"
    labels.write_text(
        json.dumps(["0% busy at 9 AM", "Currently 50% busy, usually 30% busy at 2 PM"])
    )
    result = subprocess.run(
        [sys.executable, "-I", str(copied), "--parse-labels", str(labels)],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["hours"][9] == 0 and payload["hours"][14] == 30
    assert payload["live_value"] == 50 and payload["hours"][8] is None
    # Ni .env, ni base de datos, ni Chrome son necesarios para este modo.
    assert not (tmp_path / "chrome_profile_pruebas").exists()


def test_targets_support_single_and_json_with_optional_names(tmp_path):
    url = "https://www.google.com/maps/place/Test"
    rows = module.targets([url, url], None, None)
    assert len(rows) == 1 and rows[0]["name"] is None
    file = tmp_path / "libraries.json"
    file.write_text(json.dumps([{"url": url, "name": "Test"}, "https://maps.app.goo.gl/Example"]))
    rows = module.targets([], file, None)
    assert len(rows) == 2 and rows[0]["name"] == "Test"
    with pytest.raises(ValueError, match="solo puede"):
        module.targets([url, url], None, "Test")
    with pytest.raises(ValueError, match="Indica"):
        module.targets([], None, None)


@pytest.mark.parametrize("weekly", [False, True])
def test_browser_mode_writes_only_local_files(monkeypatch, tmp_path, weekly):
    closed = []

    class Browser:
        def __init__(self, profile, manual_wait, driver_path):
            assert profile == tmp_path / "profile"

        def read(self, library, collect_week):
            assert collect_week is weekly
            assert library["name"] is None
            return {
                "name": "Ficha de prueba",
                "usual_value": 30,
                "live_value": None,
                "historical_popularity": None,
            }

        def close(self):
            closed.append(True)

    monkeypatch.setattr(module, "VisibleMaps", Browser)
    output = tmp_path / "output"
    args = [
        "--url",
        "https://www.google.com/maps/place/Test",
        "--output",
        str(output),
        "--profile",
        str(tmp_path / "profile"),
    ]
    if weekly:
        args.append("--weekly")
    assert module.main(args) == 0
    summary = json.loads(next(output.glob("*/resumen.json")).read_text())
    assert summary["processed"] == 1 and summary["failures"] == 0
    assert summary["results"][0]["status"] == "ok" and closed == [True]
    assert next(output.glob("*/lecturas.jsonl")).is_file()


def test_failure_is_saved_and_next_url_is_processed(monkeypatch, tmp_path):
    class Browser:
        def __init__(self, *args):
            pass

        def read(self, library, collect_week):
            if library["google_maps_url"].endswith("Bad"):
                raise ValueError("No hay gráfica")
            return {"name": "OK", "usual_value": None, "live_value": None}

        def close(self):
            pass

    monkeypatch.setattr(module, "VisibleMaps", Browser)
    output = tmp_path / "output"
    assert (
        module.main(
            [
                "https://www.google.com/maps/place/Bad",
                "https://www.google.com/maps/place/Good",
                "--output",
                str(output),
                "--profile",
                str(tmp_path / "profile"),
            ]
        )
        == 1
    )
    summary = json.loads(next(output.glob("*/resumen.json")).read_text())
    assert summary["processed"] == 2 and summary["failures"] == 1
    assert summary["results"][0]["error"] == "No hay gráfica"


def test_no_extra_navigation_when_google_blocks(monkeypatch, tmp_path):
    class Browser:
        def __init__(self, *args):
            pass

        def read(self, *args, **kwargs):
            raise module.BlockedPage("CAPTCHA")

        def close(self):
            pass

    monkeypatch.setattr(module, "VisibleMaps", Browser)
    output = tmp_path / "output"
    assert (
        module.main(
            [
                "https://www.google.com/maps/place/One",
                "https://www.google.com/maps/place/Two",
                "--output",
                str(output),
                "--profile",
                str(tmp_path / "profile"),
            ]
        )
        == 1
    )
    summary = json.loads(next(output.glob("*/resumen.json")).read_text())
    assert summary["blocked"] and summary["processed"] == 1


@pytest.mark.parametrize("with_valid_reading", [False, True])
def test_missing_popularity_is_skipped_without_failure(monkeypatch, tmp_path, with_valid_reading):
    class Browser:
        def __init__(self, *args):
            pass

        def read(self, library, collect_week):
            if library["google_maps_url"].endswith("NoData"):
                raise module.NoPopularityData("Sin gráfica")
            return {"name": "Con datos", "usual_value": 20, "live_value": 0}

        def close(self):
            pass

    monkeypatch.setattr(module, "VisibleMaps", Browser)
    output = tmp_path / "output"
    urls = ["https://www.google.com/maps/place/NoData"]
    if with_valid_reading:
        urls.append("https://www.google.com/maps/place/WithData")
    assert (
        module.main([*urls, "--output", str(output), "--profile", str(tmp_path / "profile")]) == 0
    )
    summary = json.loads(next(output.glob("*/resumen.json")).read_text())
    assert summary["skipped"] == 1 and summary["failures"] == 0
    assert summary["processed"] == len(urls)
    assert summary["results"][0]["status"] == "skipped"
    assert summary["results"][0]["reason"] == "no_popularity_data"
    if with_valid_reading:
        assert summary["results"][1]["status"] == "ok"
        assert summary["results"][1]["live_value"] == 0


def test_missing_control_without_bars_is_not_a_selector_error():
    from types import SimpleNamespace

    browser = module.VisibleMaps.__new__(module.VisibleMaps)
    browser.by = SimpleNamespace(CSS_SELECTOR="css")
    browser.driver = SimpleNamespace(find_elements=lambda *args: [])
    browser.labels = lambda: []
    with pytest.raises(module.NoPopularityData):
        browser.control()
    # Si hay barras pero no se encuentra su selector, sigue siendo un error real.
    browser.labels = lambda: ["50% busy at 9 AM"]
    with pytest.raises(ValueError, match="selector"):
        browser.control()
