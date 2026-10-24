"""Importación idempotente de los JSON-LD oficiales del Ayuntamiento de Madrid.

Combina el catálogo de bibliotecas (municipales y de la red de la Comunidad que publica el
Ayuntamiento) con el de salas de estudio y lectura municipales.
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import math
import os
import re
import sys
import time
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import httpx
from dotenv import load_dotenv

SOURCE_URL = (
    "https://datos.madrid.es/dataset/201747-0-bibliobuses-bibliotecas/resource/"
    "201747-2-bibliobuses-bibliotecas-json/download/201747-0-bibliobuses-bibliotecas.json"
)
SOURCE = "madrid:201747"
STUDY_ROOMS_URL = (
    "https://datos.madrid.es/dataset/217921-0-salas-estudio/resource/"
    "217921-0-salas-estudio-json/download/217921-0-salas-estudio.json"
)
STUDY_ROOMS_SOURCE = "madrid:217921"
KOS = "https://datos.madrid.es/egob/kos/entidadesYorganismos/"
INSTITUTIONS = {"ayuntamiento", "comunidad", "ucm", "otra"}
LOG = logging.getLogger("biblioradar")


@dataclass(frozen=True)
class Dataset:
    key: str
    source: str
    url: str
    # Tipos JSON-LD admitidos. El catálogo de salas mezcla oficinas de información juvenil.
    types: frozenset[str]


DATASETS = {
    "bibliotecas": Dataset(
        "bibliotecas", SOURCE, SOURCE_URL, frozenset({KOS + "BibliotecasPublicas"})
    ),
    "salas": Dataset(
        "salas", STUDY_ROOMS_SOURCE, STUDY_ROOMS_URL, frozenset({KOS + "SalasEstudioLectura"})
    ),
}

DISTRICTS = (
    "Centro",
    "Arganzuela",
    "Retiro",
    "Salamanca",
    "Chamartín",
    "Tetuán",
    "Chamberí",
    "Fuencarral-El Pardo",
    "Moncloa-Aravaca",
    "Latina",
    "Carabanchel",
    "Usera",
    "Puente de Vallecas",
    "Moratalaz",
    "Ciudad Lineal",
    "Hortaleza",
    "Villaverde",
    "Villa de Vallecas",
    "Vicálvaro",
    "San Blas-Canillejas",
    "Barajas",
)

# Red autonómica: "Biblioteca Pública X" sin "Municipal" (Pedro Salinas, Rafael Alberti, José
# Hierro de Usera...) y las Bibliotecas Públicas del Estado, que gestiona la Comunidad.
COMUNIDAD_PATTERNS = ("comunidad de madrid", "biblioteca publica", "biblioteca regional")
AYUNTAMIENTO_PATTERNS = (
    "sala de estudio",
    "salas de estudio",
    "sala de lectura",
    "sala de trabajo y lectura",
    "aula de estudio",
    "espacio de lectura",
    "espacio cultural",
    "centro cultural",
    "centro sociocultural",
    "centro intergeneracional",
)


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, (str, int, float)):
        raise ValueError("Campo de texto con estructura inesperada")
    text = str(value)
    for _ in range(3):
        text = html.unescape(text)
    return " ".join(re.sub(r"<[^>]*>", " ", text).split())


def fold(text: str) -> str:
    """Minúsculas sin tildes ni signos, para comparar textos oficiales."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return " ".join(re.findall(r"[a-z0-9]+", ascii_text))


DISTRICT_KEYS = {fold(name).replace(" ", ""): name for name in DISTRICTS}


def canonical_district(text: str) -> str | None:
    """Nombre oficial con tildes: "PuenteDeVallecas" o "San Blas - Canillejas" → canónico."""
    return DISTRICT_KEYS.get(fold(text).replace(" ", ""))


def classify_institution(name: str, record_type: str, url: str) -> str:
    key = fold(name)
    if "municipal" in key:
        return "ayuntamiento"
    if any(pattern in key for pattern in COMUNIDAD_PATTERNS):
        return "comunidad"
    if any(pattern in key for pattern in AYUNTAMIENTO_PATTERNS):
        return "ayuntamiento"
    if record_type == KOS + "SalasEstudioLectura":
        # El catálogo de salas de estudio es municipal en su totalidad.
        return "ayuntamiento"
    host = urlsplit(url).hostname or ""
    if host == "madrid.es" or host.endswith(".madrid.es"):
        return "ayuntamiento"
    return "otra"


def object_field(record: dict, key: str) -> dict:
    value = record.get(key) or {}
    if not isinstance(value, dict):
        raise ValueError(f"{key}: se esperaba un objeto")
    return value


def normalize(record: dict, overrides: dict[str, str], dataset: Dataset | None = None) -> dict:
    dataset = dataset or DATASETS["bibliotecas"]
    source_id = clean_text(record.get("id"))
    name = clean_text(record.get("title"))
    if not source_id or not name:
        raise ValueError("Falta id o nombre oficial")
    location = object_field(record, "location")
    try:
        lat = float(str(location["latitude"]).replace(",", "."))
        lng = float(str(location["longitude"]).replace(",", "."))
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Coordenadas ausentes o inválidas") from exc
    # Los catálogos se limitan a Madrid. Detecta UTM, ejes invertidos y valores anómalos.
    if not (math.isfinite(lat) and math.isfinite(lng) and 40 <= lat <= 41 and -4.5 <= lng <= -3):
        raise ValueError("Coordenadas fuera del entorno de Madrid (WGS84 esperado)")
    address = object_field(record, "address")
    district_field = address.get("district") or {}
    district_uri = (
        district_field.get("@id", "") if isinstance(district_field, dict) else district_field
    )
    raw_district = clean_text(unquote(str(district_uri)).rstrip("/").rsplit("/", 1)[-1])
    district = canonical_district(raw_district)
    if not district:
        # Algunas salas traen ".../Distrito/Distrito" o ningún distrito: usar el del título.
        suffix = re.search(r"\(([^()]+)\)\s*$", name)
        district = (canonical_district(suffix[1]) if suffix else None) or re.sub(
            r"(?<=[a-záéíóúñ])(?=[A-ZÁÉÍÓÚÑ])", " ", raw_district
        )
    if district == "Distrito":
        district = ""
    street = clean_text(address.get("street-address"))
    if not street or not district:
        raise ValueError("Falta dirección o distrito")
    org = object_field(record, "organization")
    raw_schedule = org.get("schedule") or ""
    if not isinstance(raw_schedule, str):
        raise ValueError("Horario con formato inesperado")
    source_url = clean_text(record.get("@id"))
    # La titularidad no viene como campo: se deduce del nombre y del catálogo de origen.
    institution = overrides.get(
        f"{dataset.source}:{source_id}",
        overrides.get(
            source_id, classify_institution(name, clean_text(record.get("@type")), source_url)
        ),
    )
    if institution not in INSTITUTIONS:
        raise ValueError(f"Institución desconocida: {institution}")
    return {
        "source": dataset.source,
        "source_id": source_id,
        "source_url": source_url or dataset.url,
        "name": name,
        "institution": institution,
        "address": street,
        "district": district,
        "lat": lat,
        "lng": lng,
        "opening_hours": {
            "timezone": "Europe/Madrid",
            "raw_text": raw_schedule,
            "normalized_text": clean_text(raw_schedule),
            "weekly": None,
            "requires_review": True,
        },
    }


def prepare(
    payload: Any,
    scope: str,
    overrides: dict[str, str],
    dataset: Dataset | None = None,
) -> tuple[list[dict], list[str]]:
    dataset = dataset or DATASETS["bibliotecas"]
    if not isinstance(payload, dict) or not isinstance(payload.get("@graph"), list):
        raise ValueError(f"{dataset.key}: el recurso no es el JSON-LD esperado (falta @graph)")
    if not payload["@graph"]:
        raise ValueError(f"{dataset.key}: el catálogo está vacío; se cancela la importación")
    rows: dict[str, dict] = {}
    errors = []
    other_types: Counter[str] = Counter()
    for index, record in enumerate(payload["@graph"]):
        try:
            if not isinstance(record, dict):
                raise ValueError("Registro no es un objeto")
            record_type = clean_text(record.get("@type"))
            if record_type and record_type not in dataset.types:
                other_types[record_type.rsplit("/", 1)[-1]] += 1
                continue
            row = normalize(record, overrides, dataset)
            if scope == "municipal" and row["institution"] != "ayuntamiento":
                continue
            if row["source_id"] in rows:
                raise ValueError(f"Identificador duplicado: {row['source_id']}")
            rows[row["source_id"]] = row
        except ValueError as exc:
            errors.append(f"{dataset.key}, registro {index}: {exc}")
    if other_types:
        LOG.info("%s: ignorados por tipo ajeno al catálogo: %s", dataset.key, dict(other_types))
    if not rows:
        raise ValueError(f"{dataset.key}: ningún centro válido para el ámbito solicitado")
    return list(rows.values()), errors


def prepare_all(
    payloads: list[tuple[Dataset, Any]], scope: str, overrides: dict[str, str]
) -> tuple[list[dict], list[str]]:
    rows: list[dict] = []
    errors: list[str] = []
    for dataset, payload in payloads:
        dataset_rows, dataset_errors = prepare(payload, scope, overrides, dataset)
        rows.extend(dataset_rows)
        errors.extend(dataset_errors)
    return rows, errors


def parse_json(raw: bytes) -> Any:
    # El catálogo de salas incluye saltos de línea sin escapar dentro de cadenas.
    return json.loads(raw.decode("utf-8-sig"), strict=False)


def parse_inputs(values: list[str]) -> list[tuple[Dataset, Path]]:
    """`--input RUTA` (catálogo de bibliotecas) o `--input salas=RUTA` / `bibliotecas=RUTA`."""
    inputs = []
    for value in values:
        key, sep, path = value.partition("=")
        if sep and key in DATASETS:
            inputs.append((DATASETS[key], Path(path)))
        else:
            inputs.append((DATASETS["bibliotecas"], Path(value)))
    keys = [dataset.key for dataset, _ in inputs]
    if len(keys) != len(set(keys)):
        raise ValueError("Cada catálogo solo puede indicarse una vez con --input")
    return inputs


def request_with_retry(
    client: httpx.Client, method: str, url: str, **kwargs: Any
) -> httpx.Response:
    for attempt in range(4):
        try:
            response = client.request(method, url, **kwargs)
            if response.status_code not in {429, 500, 502, 503, 504}:
                response.raise_for_status()
                return response
            if attempt == 3:
                response.raise_for_status()
            retry_after = response.headers.get("Retry-After", "")
            delay = min(float(retry_after), 30) if retry_after.isdigit() else 2**attempt
        except httpx.TransportError:
            if attempt == 3:
                raise
            delay = 2**attempt
        time.sleep(delay)
    raise RuntimeError("Reintentos agotados")


def upsert(rows: list[dict], url: str, key: str, client: httpx.Client) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("SUPABASE_URL debe ser un origen HTTPS válido")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("SUPABASE_URL debe contener solo el origen del proyecto")
    # Un solo POST: PostgREST aplica todas las filas en una transacción.
    # Campos de enriquecimiento (aforo, place_id) omitidos para conservar su valor.
    request_with_retry(
        client,
        "POST",
        f"{url.rstrip('/')}/rest/v1/libraries",
        params={"on_conflict": "source,source_id"},
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "resolution=merge-duplicates,return=minimal",
            "Content-Type": "application/json",
        },
        json=rows,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        action="append",
        default=[],
        help="JSON-LD local (bibliotecas) o CATALOGO=RUTA; repetible. Omite las descargas",
    )
    parser.add_argument(
        "--datasets",
        default="bibliotecas,salas",
        help="Catálogos a descargar, separados por comas: bibliotecas,salas",
    )
    parser.add_argument("--scope", choices=("municipal", "all"), default="municipal")
    parser.add_argument("--dry-run", action="store_true", help="Valida sin escribir en Supabase")
    parser.add_argument(
        "--output", type=Path, help="Guarda los registros normalizados para revisión"
    )
    parser.add_argument(
        "--institution-overrides",
        type=Path,
        help='JSON: {"id_oficial":"comunidad"} o {"madrid:217921:id":"otra"}',
    )
    parser.add_argument(
        "--allow-skips", action="store_true", help="Permite omitir registros inválidos"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    load_dotenv()
    try:
        overrides = (
            json.loads(args.institution_overrides.read_text()) if args.institution_overrides else {}
        )
        if not isinstance(overrides, dict) or any(
            not isinstance(k, str) or not isinstance(v, str) or v not in INSTITUTIONS
            for k, v in overrides.items()
        ):
            raise ValueError("Overrides debe asociar IDs de texto a instituciones válidas")
        with httpx.Client(timeout=httpx.Timeout(60, connect=15), follow_redirects=False) as client:
            if args.input:
                payloads = [
                    (dataset, parse_json(path.read_bytes()))
                    for dataset, path in parse_inputs(args.input)
                ]
            else:
                keys = list(dict.fromkeys(k.strip() for k in args.datasets.split(",") if k.strip()))
                unknown = sorted(set(keys) - set(DATASETS))
                if unknown or not keys:
                    raise ValueError(f"Catálogos desconocidos: {', '.join(unknown) or '(vacío)'}")
                # Cliente separado: ninguna credencial Supabase se envía al portal oficial.
                with httpx.Client(timeout=60, follow_redirects=True) as source_client:
                    payloads = [
                        (
                            DATASETS[key],
                            parse_json(
                                request_with_retry(source_client, "GET", DATASETS[key].url).content
                            ),
                        )
                        for key in keys
                    ]
            rows, errors = prepare_all(payloads, args.scope, overrides)
            for error in errors:
                LOG.warning("%s", error)
            if errors and not args.allow_skips:
                raise ValueError("Hay registros inválidos; corrige el origen o usa --allow-skips")
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(
                    json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
            LOG.info(
                "Centros válidos: %s; omitidos por error: %s; instituciones: %s; catálogos: %s",
                len(rows),
                len(errors),
                dict(Counter(row["institution"] for row in rows)),
                dict(Counter(row["source"] for row in rows)),
            )
            if args.dry_run:
                LOG.info("Validación completa; no se ha escrito en Supabase")
                return 0
            url = os.environ.get("SUPABASE_URL", "").strip()
            key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            if not url or not key:
                raise ValueError("Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env")
            upsert(rows, url, key, client)
            LOG.info("Importación completada: %s centros", len(rows))
        return 0
    except httpx.HTTPStatusError as exc:
        # Evitar volcar cuerpo/respuesta o cabeceras que puedan incluir información sensible.
        LOG.error("El servidor rechazó la petición: HTTP %s", exc.response.status_code)
    except httpx.RequestError:
        LOG.error("Error de red; comprueba conectividad y vuelve a ejecutar")
    except (ValueError, OSError) as exc:
        LOG.error("%s", exc)
    return 1


if __name__ == "__main__":
    sys.exit(main())
