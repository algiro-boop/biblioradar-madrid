#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas>=2.2,<3", "supabase>=2.15,<3", "python-dotenv>=1.1,<2"]
# ///
"""Sincronización semanal: validar por defecto; --apply confirma un único RPC atómico.

uv run sync_csv_to_supabase.py bibliotecas_madrid_popular_times.csv --catalog data/catalogo_actual.json
uv run sync_csv_to_supabase.py bibliotecas_madrid_popular_times.csv --apply
No crea coordenadas: coincidencias ambiguas o ausentes impiden aplicar todo el lote.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import unicodedata
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

DAYS = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")
CATALOG_SIZE = 97
META = (
    "nombre tipo valoracion num_resenas direccion telefono horario_lun horario_mar horario_mie "
    "horario_jue horario_vie horario_sab horario_dom nota_horario_domingo"
).split()
COLUMNS = META + [f"ocupacion_{day}_{hour:02}" for day in DAYS for hour in range(6, 24)]
GENERIC = set(
    "biblioteca bibliotecas publica publico municipal centro cultural sociocultural socio "
    "sala salas estudio estudios espacio lectura de del la el los las y madrid".split()
)


def normalize(value: str) -> str:
    value = re.sub(r"\([^)]*\)", " ", value)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return " ".join(re.findall(r"[a-z0-9]+", value))


def minute(text: str) -> int:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", text.strip())
    if not match:
        raise ValueError(f"Hora ilegible: {text!r}")
    hour, minutes = map(int, match.groups())
    if not (0 <= hour <= 24 and 0 <= minutes < 60 and (hour < 24 or minutes == 0)):
        raise ValueError(f"Hora inválida: {text!r}")
    return hour * 60 + minutes


def parse_hours(value: str) -> list[list[str]] | None:
    if not value.strip():
        return None  # Ausente no equivale a cerrado.
    if normalize(value) in {"cerrado", "cerrada", "closed"}:
        return []
    intervals = []
    for part in value.split("/"):
        match = re.fullmatch(r"\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*", part)
        if not match:
            raise ValueError(f"Horario sin reconocer: {value!r}")
        start, end = minute(match[1]), minute(match[2])
        if start >= end:
            raise ValueError("El CSV debe separar horarios que cruzan medianoche")
        if intervals and start < minute(intervals[-1][1]):
            raise ValueError("Franjas solapadas o desordenadas")
        intervals.append([f"{start // 60:02}:{start % 60:02}", f"{end // 60:02}:{end % 60:02}"])
    return intervals


def number(value: str, low: float, high: float) -> float | None:
    if not value.strip() or value.strip().lower() in {"nan", "na", "null"}:
        return None
    result = float(value.replace(",", "."))
    if not math.isfinite(result) or not low <= result <= high:
        raise ValueError(f"Número fuera de rango: {value!r}")
    return result


def import_long_popularity(records: list[dict]) -> dict:
    """Convertir el CSV largo suministrado en una fila del maestro, sin inferir huecos."""
    columns = {"centro", "direccion", "dia", "horario_apertura", "hora", "ocupacion_pct"}
    labels = ("lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo")
    if not records or any(set(r) != columns for r in records):
        raise ValueError("CSV largo vacío o con columnas inválidas")
    names = {r["centro"].strip() for r in records}
    addresses = {r["direccion"].strip() for r in records}
    if len(names) != 1 or not next(iter(names)) or len(addresses) != 1 or not next(iter(addresses)):
        raise ValueError("El CSV largo debe describir un único centro y dirección")
    groups = {label: [] for label in labels}
    for record in records:
        day = normalize(record["dia"])
        if day not in groups:
            raise ValueError("Día desconocido en CSV largo")
        groups[day].append(record)
    result = dict.fromkeys(COLUMNS, "")
    result.update(
        nombre=next(iter(names)),
        direccion=next(iter(addresses)),
        tipo="Centro cultural",
        num_resenas="0",
    )
    for label, day in zip(labels, DAYS):
        rows = groups[label]
        schedules = {r["horario_apertura"].strip() for r in rows}
        if len(schedules) != 1:
            raise ValueError("Horario ausente o inconsistente en CSV largo")
        slots = parse_hours(next(iter(schedules)))
        if slots is None:
            raise ValueError("Horario desconocido en CSV largo")
        values = {}
        if not slots:
            if len(rows) != 1 or rows[0]["hora"].strip() or rows[0]["ocupacion_pct"].strip():
                raise ValueError("Un día cerrado debe tener una única fila sin hora ni porcentaje")
            result[f"horario_{day}"] = "Cerrado"
            values = dict.fromkeys(range(6, 24), 0)
        else:
            result[f"horario_{day}"] = " / ".join("–".join(slot) for slot in slots)
            for record in rows:
                minutes = minute(record["hora"])
                hour = minutes // 60
                value = number(record["ocupacion_pct"], 0, 100)
                if minutes % 60 or hour not in range(6, 24) or hour in values or value is None:
                    raise ValueError("Hora duplicada, ausente o inválida en CSV largo")
                opened = any(
                    (hour + 1) * 60 > minute(a) and hour * 60 < minute(b) for a, b in slots
                )
                if not opened and value != 0:
                    raise ValueError("Ocupación no nula fuera del horario de apertura")
                values[hour] = value
            if set(values) != set(range(6, 24)):
                raise ValueError("Curva incompleta en CSV largo: se requieren las horas 06–23")
        for hour, value in values.items():
            result[f"ocupacion_{day}_{hour:02}"] = f"{value:g}"
    return result


def clean_curve(row: dict, day: str, intervals: list[list[str]] | None) -> list[float | None]:
    raw = [number(row[f"ocupacion_{day}_{hour:02}"], 0, 100) for hour in range(6, 24)]
    if intervals is None:
        return [None] * 18
    result: list[float | None] = [0.0] * 18
    for start, end in intervals:
        # Una hora 08:00 también representa la franja 08:00–09:00 si abre a las 08:30.
        indices = [
            i for i in range(18) if (i + 7) * 60 > minute(start) and (i + 6) * 60 < minute(end)
        ]
        for i in indices:
            result[i] = raw[i]
        # Solo huecos interiores aislados, con vecinos observados de la misma franja.
        for i in indices:
            if raw[i] is None and i - 1 in indices and i + 1 in indices:
                if raw[i - 1] is not None and raw[i + 1] is not None:
                    result[i] = (raw[i - 1] + raw[i + 1]) / 2
    return result


def prepare(records: list[dict], expected_rows: int = CATALOG_SIZE) -> list[dict]:
    if len(records) != expected_rows:
        raise ValueError(f"Se requieren {expected_rows} filas; recibidas {len(records)}")
    result, names = [], set()
    for row in records:
        if set(row) != set(COLUMNS):
            raise ValueError("El CSV debe tener exactamente las 140 columnas especificadas")
        name = row["nombre"].strip()
        key = normalize(name)
        if not key or key in names:
            raise ValueError(f"Nombre vacío/duplicado: {name!r}")
        names.add(key)
        hours = {str(i): parse_hours(row[f"horario_{day}"]) for i, day in enumerate(DAYS, 1)}
        curve = {
            str(i): {
                f"{h:02}": value
                for h, value in zip(range(6, 24), clean_curve(row, day, hours[str(i)]))
            }
            for i, day in enumerate(DAYS, 1)
        }
        reviews = number(row["num_resenas"], 0, 10_000_000)
        if reviews is not None and reviews != int(reviews):
            raise ValueError(f"num_resenas no entero en {name}")
        text = " · ".join(f"{day}: {row[f'horario_{day}']}" for day in DAYS)
        result.append(
            {
                "name": name,
                "tipo": row["tipo"].strip(),
                "valoracion": number(row["valoracion"], 0, 5),
                "num_resenas": int(reviews or 0),
                "direccion": row["direccion"].strip(),
                "telefono": row["telefono"].strip(),
                "opening_hours": {
                    "timezone": "Europe/Madrid",
                    "weekly": hours,
                    "requires_review": any(value is None for value in hours.values()),
                    "raw_text": text,
                    "normalized_text": text,
                    "date_overrides": {},
                    "sunday_note": row["nota_horario_domingo"].strip(),
                },
                "historical_popularity": {
                    "model": "csv-v1",
                    "timezone": "Europe/Madrid",
                    "days": curve,
                },
            }
        )
    return result


def match_catalog(
    rows: list[dict], catalog: list[dict], overrides: dict
) -> tuple[list[dict], list[dict]]:
    resolved, problems, used = [], [], set()
    ids = {row["id"]: row for row in catalog}
    for row in rows:
        key = normalize(row["name"])
        tokens = set(key.split()) - GENERIC
        ranked = []
        for existing in catalog:
            other = normalize(existing["name"])
            other_tokens = set(other.split()) - GENERIC
            score = (
                1.0
                if key == other
                else 0.98
                if tokens and tokens == other_tokens
                else (
                    0.8
                    * SequenceMatcher(
                        None, " ".join(sorted(tokens)), " ".join(sorted(other_tokens))
                    ).ratio()
                    + 0.2
                    * SequenceMatcher(
                        None, normalize(row["direccion"]), normalize(existing.get("address") or "")
                    ).ratio()
                )
            )
            ranked.append((score, existing["id"]))
        ranked.sort(reverse=True)
        chosen = overrides.get(row["name"])
        if (
            chosen is None
            and ranked
            and ranked[0][0] >= 0.92
            and (len(ranked) < 2 or ranked[0][0] - ranked[1][0] >= 0.06)
        ):
            chosen = ranked[0][1]
        existing = ids.get(chosen)
        valid = existing and all(
            isinstance(existing.get(k), (int, float)) and math.isfinite(existing[k])
            for k in ("lat", "lng")
        )
        if not valid or chosen in used:
            problems.append(
                {
                    "name": row["name"],
                    "reason": "unmatched_or_ambiguous",
                    "candidates": [
                        {"id": id, "name": ids[id]["name"], "score": round(score, 4)}
                        for score, id in ranked[:3]
                    ],
                }
            )
            continue
        UUID(chosen)
        used.add(chosen)
        resolved.append({**row, "id": chosen})
    return resolved, problems


def read_csv(path: Path, expected_rows: int = CATALOG_SIZE) -> list[dict]:
    import pandas as pd

    # pandas renombra cabeceras repetidas; detectarlas ANTES de que desaparezca el problema.
    with path.open(encoding="utf-8-sig", newline="") as handle:
        header = next(csv.reader(handle))
    if len(header) != 140 or len(set(header)) != 140 or set(header) != set(COLUMNS):
        raise ValueError("Cabecera CSV inválida (faltan, sobran o se repiten columnas)")
    frame = pd.read_csv(path, encoding="utf-8-sig", dtype=str).fillna("")
    return prepare(frame.to_dict("records"), expected_rows=expected_rows)


def expand_catalog(
    catalog: list[dict], locations: dict, overrides: dict
) -> tuple[list[dict], set[str]]:
    """Sembrar altas verificadas, respetando UUID explícitos aunque un homónimo ya exista."""
    expanded, new_ids = list(catalog), set()
    for name, location in locations.items():
        target = overrides.get(name)
        if target is not None:
            UUID(target)
            if any(existing["id"] == target for existing in catalog):
                continue
        elif any(normalize(existing["name"]) == normalize(name) for existing in catalog):
            continue
        if not (
            -90 <= location["lat"] <= 90
            and -180 <= location["lng"] <= 180
            and location.get("source_url", "").startswith("https://")
        ):
            raise ValueError("Ubicación nueva sin coordenadas y fuente verificadas")
        id = target or str(uuid5(NAMESPACE_URL, "biblioradar:csv:" + normalize(name)))
        if id in new_ids:
            raise ValueError("UUID duplicado en las altas nuevas")
        expanded.append({**location, "id": id, "name": name, "address": ""})
        new_ids.add(id)
    return expanded, new_ids


def apply_curve_provenance(rows: list[dict], provenance: dict) -> None:
    """Mantener trazabilidad de las curvas de referencia, sin presentarlas como mediciones."""
    names = {row["name"] for row in rows}
    if not isinstance(provenance, dict):
        raise ValueError("Procedencia de curvas inválida")
    for name, source in provenance.items():
        if (
            name not in names
            or not isinstance(source, dict)
            or source.get("kind") not in ("reference_estimate", "archetype")
            or not isinstance(source.get("method"), str)
            or not source["method"].strip()
        ):
            raise ValueError(f"Procedencia de curva inválida: {name}")
        if source["kind"] == "archetype":
            if source.get("kappa") != 6:
                raise ValueError(f"Las curvas arquetípicas requieren kappa=6: {name}")
        elif (
            not isinstance(source.get("references"), list)
            or not source["references"]
            or any(not isinstance(ref, str) or ref not in names for ref in source["references"])
        ):
            raise ValueError(f"Referencias de curva inválidas: {name}")
    for row in rows:
        if row["name"] in provenance:
            row["historical_popularity"]["provenance"] = provenance[row["name"]]


def apply_opening_exceptions(rows: list[dict], exceptions: dict) -> None:
    """Aplicar excepciones fechadas sin alterar horarios semanales ni curvas."""
    if not isinstance(exceptions, dict):
        raise ValueError("Las excepciones deben ser un objeto de nombres y fechas")
    names = {row["name"] for row in rows}
    validated = {}
    for name, dates in exceptions.items():
        if name not in names or not isinstance(dates, dict):
            raise ValueError(f"Biblioteca o excepciones inválidas: {name}")
        validated[name] = {}
        for day, slots in dates.items():
            if date.fromisoformat(day).isoformat() != day or not isinstance(slots, list):
                raise ValueError(f"Excepción inválida: {name}, {day}")
            if any(
                not isinstance(slot, list)
                or len(slot) != 2
                or any(not isinstance(t, str) for t in slot)
                for slot in slots
            ):
                raise ValueError(f"Franjas inválidas: {name}, {day}")
            validated[name][day] = (
                parse_hours(" / ".join("–".join(s) for s in slots)) if slots else []
            )
    for row in rows:
        row["opening_hours"]["date_overrides"].update(validated.get(row["name"], {}))


def apply_verified_capacities(rows: list[dict], audit: list[dict]) -> None:
    """Exact name coverage; unknown capacities always overwrite earlier values with null."""
    if not isinstance(audit, list) or any(
        not isinstance(item, dict)
        or not isinstance(item.get("name"), str)
        or "capacity" not in item
        for item in audit
    ):
        raise ValueError("Auditoría de capacidades inválida")
    indexed = {item["name"]: item for item in audit}
    if len(indexed) != len(audit) or set(indexed) != {row["name"] for row in rows}:
        raise ValueError(
            "La auditoría debe cubrir exactamente los nombres del catálogo, sin duplicados"
        )
    for item in audit:
        capacity = item["capacity"]
        if capacity is not None and (
            type(capacity) is not int
            or not 0 < capacity <= 2147483647
            or item.get("reason") != "verified_explicit_total"
            or not isinstance(item.get("raw_evidence_text"), str)
            or not item["raw_evidence_text"].strip()
            or not isinstance(item.get("source_url"), str)
            or not item["source_url"].startswith("https://")
        ):
            raise ValueError(f"Capacidad sin evidencia oficial verificada: {item['name']}")
    for row in rows:
        row["total_capacity"] = indexed[row["name"]]["capacity"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument(
        "--expected-rows",
        type=int,
        default=CATALOG_SIZE,
        help="Tamaño completo esperado del catálogo (mínimo 88)",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run", action="store_true", help="Validar sin escribir (predeterminado)"
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Aplicar catálogo atómicamente (por defecto solo validar)",
    )
    parser.add_argument(
        "--catalog", type=Path, help="Snapshot local del catálogo, para validación offline"
    )
    parser.add_argument("--overrides", type=Path, help="JSON de nombres CSV a UUID verificados")
    parser.add_argument("--output", type=Path, default=Path("data/csv_sync_plan.json"))
    parser.add_argument(
        "--new-locations", type=Path, help="JSON de ubicaciones verificadas para altas nuevas"
    )
    parser.add_argument(
        "--holidays", type=Path, help="JSON de fechas YYYY-MM-DD con ajuste festivo"
    )
    parser.add_argument(
        "--opening-exceptions",
        type=Path,
        default=Path(__file__).resolve().parent / "data/csv/opening_exceptions.json",
        help="Excepciones por biblioteca y fecha (incluye cierres temporales)",
    )
    parser.add_argument(
        "--curve-provenance",
        type=Path,
        default=Path(__file__).resolve().parent / "data/csv/curve_provenance.json",
        help="Procedencia de las curvas estimadas por referencia",
    )
    parser.add_argument(
        "--capacities-audit",
        type=Path,
        default=Path(__file__).resolve().parent / "data/csv/verified_capacities_audit.json",
        help="Auditoría oficial obligatoria; sin capacidad verificada se sincroniza null",
    )
    args = parser.parse_args(argv)
    try:
        if args.expected_rows < 88:
            raise ValueError("El catálogo completo debe contener al menos 88 centros")
        rows = read_csv(args.csv, expected_rows=args.expected_rows)
        capacities = json.loads(args.capacities_audit.read_text())
        apply_verified_capacities(rows, capacities)
        from scripts.verify_official_capacities import verify_evidence

        source_manifest = json.loads(args.capacities_audit.with_suffix(".sources.json").read_text())
        verify_evidence(
            capacities,
            source_manifest["downloads"],
            args.capacities_audit.parent / "capacity_sources",
        )
        apply_opening_exceptions(rows, json.loads(args.opening_exceptions.read_text()))
        apply_curve_provenance(rows, json.loads(args.curve_provenance.read_text()))
        client = None
        if args.catalog:
            if args.apply:
                raise ValueError(
                    "--catalog es solo para validación; aplicar requiere leer Supabase actual"
                )
            catalog = json.loads(args.catalog.read_text())
        else:
            from dotenv import load_dotenv

            from supabase import create_client

            load_dotenv()
            client = create_client(
                os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
            )
            catalog = []
            while True:
                page = (
                    client.table("libraries")
                    .select("id,name,address,lat,lng,total_capacity")
                    .order("id")
                    .range(len(catalog), len(catalog) + 499)
                    .execute()
                    .data
                )
                if not page:
                    break
                catalog.extend(page)
        overrides = json.loads(args.overrides.read_text()) if args.overrides else {}
        locations = json.loads(args.new_locations.read_text()) if args.new_locations else {}
        expanded, new_ids = expand_catalog(catalog, locations, overrides)
        resolved, problems = match_catalog(rows, expanded, overrides)
        for row in resolved:
            if row["id"] in new_ids:
                location = next(x for x in expanded if x["id"] == row["id"])
                row.update(
                    {
                        key: location[key]
                        for key in ("lat", "lng", "institution", "district", "source_url")
                    }
                )
        if args.holidays:
            holidays = json.loads(args.holidays.read_text())
            if not isinstance(holidays, list) or any(
                date.fromisoformat(d).isoformat() != d for d in holidays
            ):
                raise ValueError("Calendario festivo inválido")
            for row in resolved:
                row["opening_hours"]["holidays"] = holidays
        plan = {
            "csv_sha256": hashlib.sha256(args.csv.read_bytes()).hexdigest(),
            "capacities_audit_sha256": hashlib.sha256(
                args.capacities_audit.read_bytes()
            ).hexdigest(),
            "verified_capacities": sum(row["total_capacity"] is not None for row in resolved),
            "null_capacities": sum(row["total_capacity"] is None for row in resolved),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "matched": len(resolved),
            "new_ids": sorted(new_ids),
            "unresolved": problems,
            "deactivate": [r["id"] for r in catalog if r["id"] not in {x["id"] for x in resolved}],
            "deactivate_details": [
                {"id": r["id"], "name": r["name"]}
                for r in catalog
                if r["id"] not in {x["id"] for x in resolved}
            ],
            "rows": resolved,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(plan, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        )
        print(
            f"Emparejadas: {len(resolved)}/{len(rows)}. Pendientes: {len(problems)}. Plan: {args.output}"
        )
        if problems:
            print(
                "No se ha modificado Supabase. Resuelve el fichero de correspondencias antes de aplicar."
            )
            return 1
        if args.apply:
            print(
                client.rpc(
                    "sync_csv_catalog", {"p_rows": resolved, "p_csv_sha256": plan["csv_sha256"]}
                )
                .execute()
                .data
            )
            stored = (
                client.table("libraries")
                .select("id,total_capacity")
                .eq("is_active", True)
                .execute()
                .data
            )
            expected = {row["id"]: row["total_capacity"] for row in resolved}
            if {row["id"]: row["total_capacity"] for row in stored} != expected:
                raise ValueError(
                    "Las capacidades almacenadas no coinciden exactamente con la auditoría"
                )
            print(
                f"Capacidades verificadas en Supabase: {plan['verified_capacities']} enteros, {plan['null_capacities']} null"
            )
        else:
            print("Simulación: no se ha modificado Supabase. Usa --apply tras revisar el plan.")
        return 0
    except (ValueError, KeyError, OSError) as exc:
        print(f"Error de validación: {exc}")
        return 1
    except Exception as exc:
        print(f"Error de conexión/sincronización: {type(exc).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
