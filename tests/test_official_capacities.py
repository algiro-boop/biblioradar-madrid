"""Synthetic parsing fixtures: fixture numbers are never fed into the real audit."""

import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "official_capacities", ROOT / "scripts/verify_official_capacities.py"
)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Puestos de lectura: 185. Puestos de Internet: 39", 185),
        ("Dispone de 185 puestos de lectura y 39 puestos de internet.", 185),
        ("Puestos de estudio: 185", 185),
        ("Puestos de lectura (aforo máximo): 185 personas.", 185),
        ("Puestos de lectura: 1.185", 1185),
        ("Puestos de lectura: 185,5", None),
        ("Puestos de lectura: 1.5", None),
        ("328 puestos de lectura, varios de los cuales están adaptados para discapacitados", 328),
        ("Puestos de Internet: 39", None),
        ("39 puestos de informáticos", None),
        ("Salón de actos: aforo 185; sala de lectura sin aforo publicado.", None),
        ("Puestos de lectura: 30 y 50", None),
        ("Puestos de lectura: 96 (reducido 32)", None),
        ("Puestos de lectura: 36 de lunes a viernes y 55 los sábados.", None),
        ("Puestos de lectura: En días laborales 36 puestos de estudio y el sábado 55.", None),
        ("Aproximadamente 185 puestos de lectura", None),
        ("Hasta 185 puestos de estudio", None),
        ("Sala A: 30 puestos de lectura. Sala B: 50 puestos de lectura.", None),
        ("Otras instalaciones: 16 puestos de lectura informal y 10 de comiteca.", None),
        ("Adapt.discapacitados: 1 OPAC y 4 puestos de lectura.", None),
        (
            "Inaugurada en 2020. Financiación 2014-2020. Puestos de lectura: 185 Puestos de Internet: 20",
            185,
        ),
        ("Puestos de lectura: 185 Zona wifi. Despachos 10 y 11.", 185),
        ("Puestos de lectura: 0", None),
        ("Sin información publicada", None),
    ],
)
def test_only_explicit_unambiguous_reading_totals(text, expected):
    result = audit.extract_capacity(text)
    assert result["capacity"] == expected
    if result["raw_evidence_text"]:
        assert result["raw_evidence_text"] in text


def test_aforo_requires_dedicated_study_room():
    text = "Aforo: 185 puestos. Wifi disponible."
    assert audit.extract_capacity(text)["capacity"] is None
    assert audit.extract_capacity(text, study_room=True)["capacity"] == 185
    assert audit.extract_capacity("Aforo aproximado 185", study_room=True)["capacity"] is None
    assert (
        audit.extract_capacity("N&amp;ordm; de puestos: 185 plazas", study_room=True)["capacity"]
        == 185
    )


def test_unique_general_room_in_official_directory():
    text = "Sala General (única)\n: Capacidad: 185."
    assert audit.extract_capacity(text)["capacity"] == 185
    assert audit.extract_capacity("Auditorio: Capacidad: 185.")["capacity"] is None
    text += "\nSala adultos o principal: Capacidad: 50."
    assert audit.extract_capacity(text)["capacity"] is None


def test_html_ignores_scripts_and_preserves_literal_visible_evidence():
    html = "<script>185 puestos de lectura</script><style>p{width:185px}</style>"
    html += "<p>Puestos de lectura: <strong>42</strong>. Internet: 3.</p>"
    parser = audit.OfficialHTML()
    parser.feed(html)
    result = audit.extract_capacity(parser.text)
    assert result["capacity"] == 42
    assert result["raw_evidence_text"] == "Puestos de lectura: 42"
    assert "185" not in parser.text


def test_identity_does_not_mix_centre_and_library_or_same_name_in_another_town():
    row = {
        "nombre": "Centro Cultural Gloria Fuertes (Barajas)",
        "direccion": "Av. de Logroño, 179, 28042 Madrid",
    }
    assert audit.identity_matches(
        row, "Centro Cultural Gloria Fuertes (Barajas)", "AVENIDA LOGROÑO 179 28042"
    )
    assert not audit.identity_matches(
        row, "Biblioteca Gloria Fuertes (Barajas)", "AVENIDA LOGROÑO 179 28042"
    )
    assert not audit.identity_matches(
        row, "Centro Cultural Gloria Fuertes (Rivas)", "CALLE JOVELLANOS 30 28522"
    )


def test_identity_requires_geographic_evidence():
    row = {"nombre": "Biblioteca José Saramago", "direccion": "Calle Prueba, 1, 28001 Madrid"}
    assert not audit.identity_matches(row, "Biblioteca José Saramago", "")
    assert audit.identity_matches(row, "Biblioteca Pública José Saramago", "Calle Prueba 1 28001")


@pytest.mark.parametrize(
    "url,allowed",
    [
        ("https://datos.madrid.es/egob/catalogo/test.json", True),
        ("https://gestiona.comunidad.madrid/directorio_publicacion/", True),
        ("https://biblioteca.ucm.es/", True),
        ("https://madrid.es.evil.test/", False),
        ("https://google.com/maps", False),
        ("file:///tmp/test", False),
    ],
)
def test_official_domain_allowlist(url, allowed):
    assert audit.official_url(url) is allowed


def test_http_snapshot_hash_cache_and_redirect_safety(tmp_path):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        if request.url.path == "/redirect":
            return httpx.Response(302, headers={"Location": "https://unofficial.test/"})
        return httpx.Response(200, json={"organization": {"services": "Puestos de lectura: 42"}})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            downloader = audit.Downloader(client, tmp_path)
            url = "https://datos.madrid.es/test.json"
            first, second = await asyncio.gather(downloader.get(url), downloader.get(url))
            assert first == second
            assert requests.count(url) == 1
            raw = (tmp_path / first["snapshot"]).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == first["sha256"]
            assert json.loads(raw)["organization"]["services"] == "Puestos de lectura: 42"
            rejected = await downloader.get("https://datos.madrid.es/redirect")
            assert "non-official" in rejected["error"]
            assert "https://unofficial.test/" not in requests

    asyncio.run(scenario())


def test_evidence_replays_and_detects_modified_number_or_snapshot(tmp_path):
    record = {
        "id": "fixture-only",
        "title": "Biblioteca de prueba",
        "organization": {"services": "Puestos de lectura: 42"},
    }
    raw = json.dumps({"@graph": [record]}).encode()
    digest = hashlib.sha256(raw).hexdigest()
    filename = digest + ".response"
    (tmp_path / filename).write_bytes(raw)
    url = "https://datos.madrid.es/fixture.json"
    document = {"url": url, "sha256": digest, "snapshot": filename, "encoding": "utf-8"}
    candidate = {
        **audit.extract_capacity(record["organization"]["services"]),
        "record_id": record["id"],
        "field": "organization.services",
        "source_url": url,
        "sha256": digest,
        "snapshot": filename,
    }
    result = {
        "name": "Fixture",
        "capacity": 42,
        "raw_evidence_text": candidate["raw_evidence_text"],
        "source_url": url,
        "evidence_candidates": [candidate],
    }
    assert audit.verify_evidence([result], [document], tmp_path) == 1
    result["capacity"] = 99
    with pytest.raises(ValueError, match="Missing evidence"):
        audit.verify_evidence([result], [document], tmp_path)
    result["capacity"] = 42
    (tmp_path / filename).write_bytes(b"modified")
    with pytest.raises(ValueError, match="hash mismatch"):
        audit.verify_evidence([result], [document], tmp_path)
