"""Only the reviewed migration may be sent; credentials must never appear in output."""

import importlib.util
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "apply_capacity", ROOT / "scripts/apply_official_capacities.py"
)
apply = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(apply)


def configure(monkeypatch):
    monkeypatch.setattr(apply, "load_dotenv", lambda *args: None)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ACCESS_TOKEN", raising=False)


def test_missing_admin_credentials_do_not_execute_ddl(monkeypatch, capsys):
    configure(monkeypatch)
    assert apply.main() == 1
    assert "no se ha ejecutado SQL" in capsys.readouterr().out


def test_management_api_receives_exact_reviewed_sql(monkeypatch, capsys):
    configure(monkeypatch)
    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", "secret-fixture")
    monkeypatch.setenv("SUPABASE_URL", "https://fixture.supabase.co")
    requests = []

    def handle(request):
        import json

        requests.append(request)
        assert json.loads(request.content)["query"] == apply.MIGRATION.read_text()
        assert request.headers["authorization"] == "Bearer secret-fixture"
        return httpx.Response(200, json=[])

    real_client = httpx.Client
    monkeypatch.setattr(
        apply.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    assert apply.main() == 0
    assert len(requests) == 1
    assert str(requests[0].url) == "https://api.supabase.com/v1/projects/fixture/database/query"
    assert "secret-fixture" not in capsys.readouterr().out


def test_invalid_project_origin_is_rejected_without_leaking_credentials(monkeypatch, capsys):
    configure(monkeypatch)
    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", "secret-fixture")
    monkeypatch.setenv("SUPABASE_URL", "https://unofficial.test")
    assert apply.main() == 1
    assert "secret-fixture" not in capsys.readouterr().out
