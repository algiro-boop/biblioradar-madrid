"""Cron: python -m biblioradar.update_job [--dry-run]."""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv

from biblioradar.engine import (
    DEFAULT_OPEN_FROM,
    DEFAULT_OPEN_UNTIL,
    HEURISTIC_SOURCE,
    MADRID,
    aware,
    heuristic_base,
    predict_base,
)
from biblioradar.ingest import request_with_retry
from biblioradar.scrapers import Observation, get_observation
from biblioradar.weather import get_weather

LOG = logging.getLogger("biblioradar.update")


def credentials() -> tuple[str, dict[str, str]]:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
        or not key
    ):
        raise ValueError("Configura un origen HTTPS SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY")
    return url, {"apikey": key, "Authorization": f"Bearer {key}"}


def read_libraries(client: httpx.Client, url: str, headers: dict) -> list[dict]:
    rows = []
    offset = 0
    while True:
        page = request_with_retry(
            client,
            "GET",
            f"{url}/rest/v1/libraries",
            headers=headers,
            params={
                "select": (
                    "id,name,institution,district,address,lat,lng,google_place_id,opening_hours"
                ),
                "order": "id.asc",
                "limit": 500,
                "offset": offset,
            },
        ).json()
        if not isinstance(page, list):
            raise ValueError("Respuesta inesperada de libraries")
        if not page:
            return rows
        rows.extend(page)
        offset += len(page)  # También funciona si el servidor limita la página a menos de 500.


def opening_status(hours: dict, now: datetime) -> bool | None:
    """None: horario sin revisar; consultar conservadoramente dentro de la ventana del cron.

    weekly usa ISO 1=lunes..7=domingo; intervalos [HH:MM,HH:MM].
    date_overrides permite festivos/cierres por YYYY-MM-DD. Fin 24:00 admitido.
    """
    if isinstance(hours, dict) and hours.get("temporarily_closed") is True:
        return False
    if not isinstance(hours, dict) or hours.get("requires_review", True):
        return None
    weekly = hours.get("weekly")
    if not isinstance(weekly, dict):
        return None
    local = aware(now).astimezone(ZoneInfo(hours.get("timezone", "Europe/Madrid")))
    overrides = hours.get("date_overrides", {})

    def minute(value: str) -> int:
        hour, minutes = map(int, value.split(":"))
        if not (0 <= hour <= 24 and 0 <= minutes < 60 and (hour < 24 or minutes == 0)):
            raise ValueError("Hora inválida")
        return hour * 60 + minutes

    try:
        for delta in (0, 1):
            day = local.date() - timedelta(days=delta)
            intervals = overrides.get(day.isoformat(), weekly.get(str(day.isoweekday())))
            if intervals is None:
                return None
            for start, end in intervals:
                start_m, end_m = minute(start), minute(end)
                if end_m <= start_m:
                    end_m += 1440
                current = delta * 1440 + local.hour * 60 + local.minute
                if start_m <= current < end_m:
                    return True
        return False
    except (ValueError, TypeError, AttributeError):
        return None


MONTHS = (
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre"
).split()
# Frase con la que la Comunidad declara los días: "Apertura de lunes a sábado."
DECLARED_DAYS = re.compile(r"apertura de lunes a (viernes|sabado|domingo)\b")
# Frases de temporada ("Julio: ...", "Verano (15 jun a 15 sept): ...") no rigen hoy.
SEASONAL = re.compile(
    r"^(?:horario\s+(?:especial\s+)?(?:de\s+)?)?(?:"
    + "|".join(MONTHS)
    + r"|verano|invierno|navidad|semana santa|examenes|campana)\b"
)
DATED = re.compile(r"\d+\s+de\s+(?:" + "|".join(MONTHS) + r")\b")
CLOSED_WORDS = re.compile(r"cerrad|cierr|no abre")
TIME_RANGE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:a|-|–)\s*(\d{1,2})(?::(\d{2}))?\b")
# Menciones del día en el texto. "Todos los días" solo cuenta con un tramo horario,
# porque la Comunidad lo usa también para "todos los días los servicios... finalizarán".
WEEKEND_MENTION = {
    6: re.compile(r"sabado|fines? de semana|todos los dias|lunes a (?:a )?domingo"),
    7: re.compile(r"domingo|fines? de semana|todos los dias"),
}
WEEKEND_EXPLICIT = {
    6: re.compile(r"sabado|fines? de semana"),
    7: re.compile(r"domingo|fines? de semana"),
}


def published_weekend_status(hours: dict, now: datetime) -> bool | None:
    """Sábado o domingo según el texto del catálogo, para centros sin horario estructurado.

    True abierta ahora; False cerrada (el texto excluye el día o la hora cae fuera de sus
    tramos); None no se deduce nada. Entre semana devuelve None: rige la franja por defecto.
    Ante señales contradictorias gana el cierre: nunca se inventa una sala abierta.
    """
    if not isinstance(hours, dict):
        return None
    local = aware(now).astimezone(MADRID)
    weekday = local.isoweekday()
    if weekday < 6:
        return None
    raw = str(hours.get("normalized_text") or hours.get("raw_text") or "")
    text = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode().lower()
    declared = DECLARED_DAYS.search(text)
    if declared and (declared[1] == "viernes" or (weekday == 7 and declared[1] != "domingo")):
        return False
    day_open = declared is not None
    intervals = []
    for clause in (c.strip(" ,:()") for c in re.split(r"[.;\n]+", text)):
        closed = CLOSED_WORDS.search(clause)
        if closed and WEEKEND_EXPLICIT[weekday].search(clause) and not DATED.search(clause):
            return False  # "Sábados, domingos y festivos cerrado."
        mention = WEEKEND_MENTION[weekday].search(clause)
        if closed or not mention or SEASONAL.match(clause):
            continue
        # Tramos tras la mención del día ("L-V de 8:30 a 21, sábado de 8:30 a 15").
        ranges = TIME_RANGE.findall(clause[mention.start() :]) or TIME_RANGE.findall(clause)
        if not ranges and mention[0] == "todos los dias":
            continue
        day_open = True
        for h0, m0, h1, m1 in ranges:
            start, end = int(h0) * 60 + int(m0 or 0), int(h1) * 60 + int(m1 or 0)
            if int(h0) > 24 or int(h1) > 24 or not start < end <= 1440:
                return None  # Tramo ilegible: no se adivina.
            intervals.append((start, end))
    current = local.hour * 60 + local.minute
    if intervals:
        return any(start <= current < end for start, end in intervals)
    if day_open:
        return True if DEFAULT_OPEN_FROM * 60 <= current < DEFAULT_OPEN_UNTIL * 60 else None
    return None


# Validez de cada base: varios ciclos del cron (cada 15 min) aunque GitHub lo retrase, salvo
# que antes cambie la apertura. La web recalcula la estimación horaria al caducar.
BASE_VALID_MINUTES = 90
# Peticiones simultáneas a fuentes externas (Google, UCM). httpx.Client admite hilos.
SOURCE_WORKERS = 6


def open_at(hours: dict, observation: Observation | None, when: datetime) -> bool:
    """Apertura prevista en `when` con la misma prioridad que el cálculo de la base.

    Horario revisado, horario de Google del día, texto publicado de fin de semana y, por
    último, la franja por defecto de la estimación horaria (L-V 8:30-21:00).
    """
    for status in (
        opening_status(hours, when),
        observation.open_at(when) if observation else None,
        published_weekend_status(hours, when),
    ):
        if status is not None:
            return status
    return heuristic_base(when, False, open_now=None) is not None


def base_valid_until(now: datetime, is_open) -> datetime:
    """Primer minuto en que cambia la apertura (p. ej. 09:00) o, si no cambia, now + margen."""
    current = is_open(now)
    minute = now.replace(second=0, microsecond=0)
    for step in range(1, BASE_VALID_MINUTES + 1):
        when = minute + timedelta(minutes=step)
        if when - now >= timedelta(minutes=BASE_VALID_MINUTES):
            break
        if is_open(when) != current:
            return when
    return now + timedelta(minutes=BASE_VALID_MINUTES)


def library_row(
    sources: httpx.Client, library: dict, now: datetime, raining: bool, weather_known: bool
) -> tuple[dict, Observation | None]:
    reviewed = opening_status(library.get("opening_hours", {}), now)
    closed = {
        "library_id": library["id"],
        "google_live_pct": None,
        "google_hist_pct": None,
        "predicted_base_pct": None,
    }
    if reviewed is False:
        return {**closed, "base_source": "Cerrada según horario revisado"}, None
    observation = get_observation(sources, library, now)
    if observation.error:
        LOG.warning("%s: %s", library["id"], observation.error)
    # El horario revisado manda; si falta, se usa el horario estructurado de Google.
    open_now = reviewed if reviewed is not None else observation.open_now
    if open_now is False and observation.university_live_pct is None:
        return {**closed, "base_source": "Cerrada según horario de Google"}, observation
    if open_now is None:
        # Último recurso: el texto publicado ("Sábados de 9 a 14 horas").
        open_now = published_weekend_status(library.get("opening_hours"), now)
        if open_now is False and observation.university_live_pct is None:
            return {**closed, "base_source": "Cerrada según horario publicado"}, observation
    if observation.university_live_pct is not None:
        base = observation.university_live_pct  # Medición directa, sin ajuste contextual.
        source = observation.source
    else:
        base = predict_base(
            observation.google_live_pct,
            observation.google_hist_pct,
            now.astimezone(MADRID),
            raining,
        )
        source = (
            "Concurrencia Google en vivo"
            if observation.google_live_pct is not None
            else "Estimación contextual + histórico Google"
            if base is not None
            else "Sin datos de concurrencia"
        )
        if base is None:
            # Sin afluencia de Google (salas pequeñas o respuesta sin gráfica):
            # curva horaria de Madrid ajustada por exámenes, fin de semana y lluvia.
            base = heuristic_base(now, raining, open_now=open_now, library=library)
            if base is not None:
                source = HEURISTIC_SOURCE
        if not weather_known and base is not None and observation.google_live_pct is None:
            source += " · clima no disponible"
    row = {
        "library_id": library["id"],
        "google_live_pct": observation.google_live_pct,
        "google_hist_pct": observation.google_hist_pct,
        "predicted_base_pct": base,
        "base_source": source,
    }
    return row, observation


def run_job(
    database: httpx.Client,
    sources: httpx.Client,
    url: str,
    headers: dict,
    *,
    dry_run: bool = False,
    now: datetime | None = None,
) -> list[dict]:
    now = aware(now or datetime.now(timezone.utc))
    libraries = read_libraries(database, url, headers)
    if not libraries:
        LOG.info("Catálogo vacío; no hay bibliotecas que actualizar")
        return []
    raining = False
    weather_known = True
    try:
        raining = get_weather(sources, now).is_raining
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        weather_known = False
        LOG.warning(
            "Clima no disponible (%s); no se aplica multiplicador de lluvia", type(exc).__name__
        )
    for library in libraries:
        UUID(library["id"])
    # Consultas en paralelo moderado: ~1 s por centro en serie, unos 20 s para 119 con 6.
    with ThreadPoolExecutor(max_workers=SOURCE_WORKERS) as pool:
        results = list(
            pool.map(
                lambda library: library_row(sources, library, now, raining, weather_known),
                libraries,
            )
        )
    updates = []
    heuristic_count = 0
    for library, (row, observation) in zip(libraries, results):
        heuristic_count += row["base_source"].startswith(HEURISTIC_SOURCE)
        hours = library.get("opening_hours", {})
        row["base_valid_until"] = base_valid_until(
            now, lambda when: open_at(hours, observation, when)
        ).isoformat()
        updates.append(row)
    if not dry_run:
        for offset in range(0, len(updates), 1000):
            batch = updates[offset : offset + 1000]
            result = request_with_retry(
                database,
                "POST",
                f"{url}/rest/v1/rpc/update_occupancy_bases",
                headers=headers,
                json={"p_updates": batch},
            ).json()
            if type(result) is not int or result != len(batch):
                raise ValueError("RPC devolvió un número de actualizaciones inesperado")
    LOG.info(
        "%s: %s bibliotecas; bases disponibles: %s (estimación horaria: %s); cerradas: %s",
        "Simulación sin escrituras" if dry_run else "Actualización completada",
        len(updates),
        sum(row["predicted_base_pct"] is not None for row in updates),
        heuristic_count,
        sum(row["base_source"].startswith("Cerrada") for row in updates),
    )
    return updates


def legacy_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Lee y calcula, sin escrituras RPC")
    parser.add_argument("--output", type=Path, help="Guarda las bases calculadas en JSON")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    load_dotenv()
    try:
        url, headers = credentials()
        # Credenciales solo en llamadas a PostgREST; jamás a fuentes externas o redirecciones.
        with (
            httpx.Client(timeout=30, follow_redirects=False) as database,
            httpx.Client(timeout=httpx.Timeout(12, connect=5), follow_redirects=True) as sources,
        ):
            rows = run_job(database, sources, url, headers, dry_run=args.dry_run)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        return 0
    except httpx.HTTPStatusError as exc:
        LOG.error("PostgREST rechazó la petición: HTTP %s", exc.response.status_code)
    except httpx.RequestError:
        LOG.error("Error de red consultando Supabase")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        LOG.error("Actualización interrumpida (%s)", type(exc).__name__)
    return 1


def main(argv: list[str] | None = None) -> int:
    # Compatibilidad con comandos antiguos: desde CSV-v1 nunca se inicia scraping.
    from biblioradar.csv_job import main as csv_main

    return csv_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
