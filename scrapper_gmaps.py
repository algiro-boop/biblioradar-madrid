#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.30,<5", "httpx>=0.28,<0.29", "python-dotenv>=1.1,<2"]
# ///
"""Scraper local de Maps con Chrome visible; no ejecuta inferencia ni instala cron.

    uv run scrapper_gmaps.py --dry-run --limit 1 --manual-wait 120
    uv run scrapper_gmaps.py --limit 5

Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env (solo servidor).
Las columnas google_maps_url/historical_popularity de libraries y los campos crudos
Google de occupancy_status, además de scraped_logs, deben existir previamente.
Este script NO crea ni migra tablas, ni modifica la ocupación consolidada.

Salida: JSONL local recuperable, incluso si falla una escritura en Supabase.
La persistencia REST usa varias transacciones: un fallo puede dejar escrituras parciales.
Las inserciones del log usan un UUID estable por lectura para reintentar sin duplicados.
Histórico: {"timezone":"Europe/Madrid","days":{"1":[24 valores],...,"7":[24 valores]},
"complete":true,"missing_data_days":[],"scraped_at":"..."}; complete indica 7 días recorridos.
ISO 1=lunes, horas ausentes=null, nunca cero supuesto.
Google muestra popularidad relativa, no un porcentaje certificado de asientos ocupados.
El perfil visible conserva consentimiento, pero no garantiza ausencia de bloqueos.
Consentimientos/CAPTCHAs se resuelven manualmente; no se intentan eludir.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
import os
import random
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv

LOG = logging.getLogger("scrapper_gmaps")
MADRID = ZoneInfo("Europe/Madrid")
DAYS = {
    "monday": 1,
    "lunes": 1,
    "tuesday": 2,
    "martes": 2,
    "wednesday": 3,
    "miercoles": 3,
    "thursday": 4,
    "jueves": 4,
    "friday": 5,
    "viernes": 5,
    "saturday": 6,
    "sabado": 6,
    "sunday": 7,
    "domingo": 7,
}
BUSY = re.compile(r"busy|popular|concurr|ocup|afluenc", re.I)
LIVE = re.compile(r"currently|right now|live|actualmente|en directo|en vivo|ahora", re.I)
USUAL = re.compile(r"usually|typically|normally|normalmente|habitual|suele|por lo general", re.I)
PERCENT = re.compile(r"(?<![\d.+-])(\d{1,3})\s*%")
HOUR = re.compile(
    r"\b(?:at|a las|a la)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?", re.I
)
GOOGLE_HOSTS = {
    "google.com",
    "www.google.com",
    "maps.google.com",
    "google.es",
    "www.google.es",
    "maps.app.goo.gl",
    "goo.gl",
}


def normalized(text: str) -> str:
    return " ".join(
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower().split()
    )


def weekday(text: str) -> int | None:
    match = re.match(r"^\s*([a-z]+)\b", normalized(text))
    return DAYS.get(match[1]) if match else None


def percentage(text: str) -> int | None:
    match = PERCENT.search(text)
    return int(match[1]) if match and 0 <= int(match[1]) <= 100 else None


@dataclass(frozen=True)
class Bar:
    hour: int | None
    usual: int | None
    live: int | None


def parse_bar(label: str) -> Bar | None:
    """Solo cifras explícitas aria-label; no estima con alturas CSS ni texto cualitativo."""
    label = normalized(label)
    if not BUSY.search(label):
        return None
    match = HOUR.search(label)
    hour = None
    if match:
        hour = int(match[1])
        minute = int(match[2] or 0)
        meridiem = re.sub(r"[.\s]", "", match[3] or "").lower()
        if minute != 0 or (meridiem and not 1 <= hour <= 12) or (not meridiem and hour > 23):
            return None
        if meridiem:
            hour = hour % 12 + (12 if meridiem == "pm" else 0)
    live_mark, usual_mark = LIVE.search(label), USUAL.search(label)
    if live_mark:
        live_end = (
            usual_mark.start()
            if usual_mark and usual_mark.start() > live_mark.end()
            else len(label)
        )
        live = percentage(label[live_mark.end() : live_end])
        if usual_mark:
            usual_end = live_mark.start() if live_mark.start() > usual_mark.end() else len(label)
            usual = percentage(label[usual_mark.end() : usual_end])
        else:
            usual = None
    else:
        live, usual = None, percentage(label)
    if live is None and (hour is None or usual is None):
        return None
    return Bar(hour, usual, live)


def daily_values(labels: list[str]) -> tuple[list[int | None], int | None]:
    hours: list[int | None] = [None] * 24
    conflicts: set[int] = set()
    lives = set()
    for label in labels:
        bar = parse_bar(label)
        if bar is None:
            continue
        if bar.live is not None:
            lives.add(bar.live)
        if bar.hour is not None and bar.usual is not None:
            if hours[bar.hour] is not None and hours[bar.hour] != bar.usual:
                conflicts.add(bar.hour)
            hours[bar.hour] = bar.usual
    for hour in conflicts:
        hours[hour] = (
            None  # Etiquetas contradictorias: dato desconocido, no elegir arbitrariamente.
        )
    return hours, next(iter(lives)) if len(lives) == 1 else None


def valid_maps_url(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError("Falta google_maps_url o es inválida")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in GOOGLE_HOSTS
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
    ):
        raise ValueError("google_maps_url debe ser HTTPS de Google Maps")
    if parsed.hostname not in {"maps.app.goo.gl", "goo.gl"} and not (
        parsed.path.startswith("/maps") or parsed.hostname == "maps.google.com"
    ):
        raise ValueError("La URL no corresponde a Maps")
    return value


class NoPopularityData(RuntimeError):
    """Ficha válida sin gráfica/porcentajes publicados; omitir sin tratarlo como fallo."""


class BlockedPage(RuntimeError):
    pass


class VisibleMaps:
    def __init__(self, profile: Path, manual_wait: int = 0):
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait

        self.by = By
        self.wait_class = WebDriverWait
        self.manual_wait = manual_wait
        self._graph_root = None
        options = webdriver.ChromeOptions()
        # Visible por diseño: Selenium no tiene una opción headless=False; basta no activarla.
        options.add_argument(f"--user-data-dir={profile.resolve()}")
        options.add_argument("--lang=en-US")
        options.add_experimental_option("prefs", {"intl.accept_languages": "en-US,en,es"})
        options.page_load_strategy = "eager"
        self.driver = webdriver.Chrome(options=options)  # Selenium Manager resuelve ChromeDriver.
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)

    @staticmethod
    def pause() -> None:
        time.sleep(random.uniform(3.5, 6.5))

    def close(self) -> None:
        self.driver.quit()

    def blocked(self) -> bool:
        host = urlsplit(self.driver.current_url).hostname or ""
        return (
            host.startswith("consent.google.")
            or "/sorry/" in self.driver.current_url
            or bool(
                self.driver.find_elements(
                    self.by.CSS_SELECTOR, 'iframe[src*="recaptcha"], form[action*="/sorry/"]'
                )
            )
        )

    def check_access(self) -> None:
        if not self.blocked():
            return
        if self.manual_wait:
            LOG.warning(
                "Consentimiento/CAPTCHA: resuélvelo en Chrome; espera máxima %s s", self.manual_wait
            )
            try:
                self.wait_class(self.driver, self.manual_wait).until(lambda _: not self.blocked())
                return
            except Exception as exc:
                raise BlockedPage("Google sigue bloqueado; detener y resolver manualmente") from exc
        raise BlockedPage("Google pide consentimiento/CAPTCHA; usa --manual-wait 120")

    def labels(self, root: Any = None) -> list[str]:
        root = root if root is not None else self.driver
        return [
            label
            for element in root.find_elements(self.by.CSS_SELECTOR, "[aria-label]")
            if element.is_displayed()
            and (label := element.get_attribute("aria-label"))
            and parse_bar(label) is not None
        ]

    def control(self) -> tuple[Any, int]:
        # No depende de clases CSS ofuscadas. Limita la selección a controles de día.
        elements = self.driver.find_elements(
            self.by.CSS_SELECTOR,
            '[role="combobox"], [aria-haspopup], [role="button"], [role="tab"][aria-selected="true"]',
        )
        matches = []
        for element in elements:
            if not element.is_displayed():
                continue
            day = weekday(element.text) or weekday(element.get_attribute("aria-label") or "")
            if day is not None:
                matches.append((element, day))
        if not matches and not self.labels():
            raise NoPopularityData("Google no muestra datos de concurrencia para esta biblioteca")
        if len(matches) != 1:
            raise ValueError("No se puede identificar un selector único de días de concurrencia")
        return matches[0]

    def graph_labels(self) -> list[str]:
        control, _ = self.control()
        root = control
        for _ in range(7):
            root = root.find_element(self.by.XPATH, "..")
            labels = self.labels(root)
            if labels:
                self._graph_root = root
                return labels
        # Un día seleccionado puede no tener barras (cerrado/sin datos): conservar null.
        if self._graph_root is not None and self._graph_root.is_displayed():
            return self.labels(self._graph_root)
        raise NoPopularityData("Biblioteca sin porcentajes de concurrencia legibles")

    def select_day(self, target: int) -> None:
        self.check_access()
        control, current = self.control()
        if current == target:
            return
        if control.get_attribute("role") != "tab":
            control.click()

        def option(_):
            candidates = self.driver.find_elements(
                self.by.CSS_SELECTOR,
                '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="listbox"] [role="button"]',
            )
            matches = [
                e
                for e in candidates
                if e.is_displayed()
                and (weekday(e.text) or weekday(e.get_attribute("aria-label") or "")) == target
            ]
            return matches[0] if len(matches) == 1 else False

        self.wait_class(self.driver, 10).until(option).click()
        self.wait_class(self.driver, 10).until(lambda _: self.control()[1] == target)
        self.pause()  # La etiqueta cambia antes que la gráfica; dejar que termine su carga.
        self.check_access()

    def read(self, library: dict, collect_week: bool) -> dict:
        self._graph_root = None
        self.driver.get(valid_maps_url(library.get("google_maps_url")))
        self.pause()
        self.check_access()
        valid_maps_url(self.driver.current_url)
        title = self.wait_class(self.driver, 20).until(
            lambda d: next(
                (
                    e.text
                    for e in d.find_elements(self.by.CSS_SELECTOR, "h1")
                    if e.is_displayed() and e.text
                ),
                False,
            )
        )
        generic = set(
            "biblioteca publica publico municipal library public madrid de del la el centro sala estudio".split()
        )
        wanted = (
            set(re.findall(r"[a-z0-9]+", normalized(re.sub(r"\([^)]*\)", "", library["name"]))))
            - generic
        )
        found = set(re.findall(r"[a-z0-9]+", normalized(title))) - generic
        if not wanted or not found or len(wanted & found) / min(len(wanted), len(found)) < 0.75:
            raise ValueError("La ficha abierta no coincide con el nombre de la biblioteca")
        # Scroll suave del panel, no del mapa. No realiza clics de consentimiento ni CAPTCHA.
        headings = self.driver.find_elements(self.by.CSS_SELECTOR, "h1")
        if headings:
            self.driver.execute_script(
                """
                let e=arguments[0];
                while(e && e.scrollHeight <= e.clientHeight) e=e.parentElement;
                if(e) e.scrollBy({top: 450, behavior: 'smooth'});
            """,
                headings[0],
            )
        self.pause()
        now = datetime.now(timezone.utc)
        local = now.astimezone(MADRID)
        self.select_day(local.isoweekday())
        labels = self.graph_labels()
        now = datetime.now(timezone.utc)
        local = now.astimezone(MADRID)
        if self.control()[1] != local.isoweekday():
            self.select_day(local.isoweekday())
            labels = self.graph_labels()
            now = datetime.now(timezone.utc)
            local = now.astimezone(MADRID)
        hours, live = daily_values(labels)
        usual = hours[local.hour]
        # Una barra Live sin hora puede contener el habitual actual explícito.
        paired = {
            bar.usual
            for label in labels
            if (bar := parse_bar(label)) is not None
            and bar.live is not None
            and bar.hour in (None, local.hour)
            and bar.usual is not None
        }
        if usual is None and len(paired) == 1:
            usual = next(iter(paired))
        history = None
        if collect_week:
            days = {str(local.isoweekday()): hours}
            for day in range(1, 8):
                if day == local.isoweekday():
                    continue
                try:
                    self.select_day(day)
                    values, _ = daily_values(self.graph_labels())
                    days[str(day)] = values
                except BlockedPage:
                    raise
                except Exception:
                    LOG.warning("No se pudo leer el día ISO %s de %s", day, library["id"])
            if len(days) == 7 and any(
                value is not None for values in days.values() for value in values
            ):
                history = {
                    "timezone": "Europe/Madrid",
                    "days": days,
                    "complete": True,
                    "missing_data_days": [
                        day for day, values in days.items() if all(v is None for v in values)
                    ],
                    "scraped_at": now.isoformat(),
                }
            else:
                LOG.info(
                    "Histórico incompleto en %s; no se guarda como matriz semanal", library["id"]
                )
        # Hora exacta de la lectura actual, no el final del recorrido semanal.
        return {
            "id": str(uuid4()),
            "library_id": library["id"],
            "live_value": live,
            "usual_value": usual,
            "created_at": now.isoformat(),
            "historical_popularity": history,
        }


class Supabase:
    def __init__(self, client: httpx.Client, url: str, key: str):
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or not key
        ):
            raise ValueError("Configura SUPABASE_URL (origen HTTPS) y SUPABASE_SERVICE_ROLE_KEY")
        self.client, self.url = client, url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def request(self, method: str, table: str, **kwargs: Any) -> httpx.Response:
        headers = self.headers | kwargs.pop("headers", {})
        for attempt in range(4):
            try:
                response = self.client.request(
                    method, f"{self.url}/{table}", headers=headers, **kwargs
                )
                if response.status_code not in (429, 500, 502, 503, 504) or attempt == 3:
                    response.raise_for_status()
                    return response
            except httpx.TransportError:
                if attempt == 3:
                    raise
            time.sleep(2**attempt)
        raise RuntimeError("Reintentos agotados")

    def libraries(self) -> list[dict]:
        rows = []
        while True:
            try:
                page = self.request(
                    "GET",
                    "libraries",
                    params={
                        "select": "id,name,lat,lng,google_maps_url,historical_popularity",
                        "order": "id.asc",
                        "limit": 500,
                        "offset": len(rows),
                    },
                ).json()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 400:
                    raise ValueError(
                        "Revisa el esquema: libraries necesita google_maps_url y historical_popularity"
                    ) from exc
                raise
            if not isinstance(page, list):
                raise ValueError("Supabase no devolvió una lista de bibliotecas")
            if not page:
                return rows
            rows.extend(page)

    def persist(self, reading: dict) -> None:
        # Registrar primero el dato crudo, con ID reutilizable en cada reintento.
        self.request(
            "POST",
            "scraped_logs",
            params={"on_conflict": "id"},
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            json={
                k: reading[k]
                for k in ("id", "library_id", "live_value", "usual_value", "created_at")
            },
        )
        response = self.request(
            "PATCH",
            "occupancy_status",
            params={"library_id": f"eq.{reading['library_id']}"},
            headers={"Prefer": "return=representation"},
            json={
                "google_live_busyness": reading["live_value"],
                "google_usual_busyness": reading["usual_value"],
                "last_scraped_at": reading["created_at"],
            },
        )
        if len(response.json()) != 1:
            raise ValueError("La biblioteca no tiene una fila única en occupancy_status")
        if reading["historical_popularity"] is not None:
            # No sobreescribir un histórico que otro proceso haya guardado mientras scrapeábamos.
            self.request(
                "PATCH",
                "libraries",
                params={"id": f"eq.{reading['library_id']}", "historical_popularity": "is.null"},
                json={"historical_popularity": reading["historical_popularity"]},
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Lee Supabase/Maps, sin escrituras en Supabase"
    )
    parser.add_argument("--limit", type=int, help="Máximo de bibliotecas")
    parser.add_argument("--library-id", help="Solo esta biblioteca (UUID)")
    parser.add_argument("--profile", type=Path, default=Path("chrome_profile"))
    parser.add_argument(
        "--output", type=Path, help="JSONL de lecturas; por defecto data/gmaps-<fecha>.jsonl"
    )
    parser.add_argument(
        "--manual-wait",
        type=int,
        default=0,
        help="Segundos para resolver consentimiento/CAPTCHA a mano",
    )
    args = parser.parse_args(argv)
    if args.limit is not None and args.limit < 1 or args.manual_wait < 0:
        parser.error("--limit debe ser positivo y --manual-wait no negativo")
    if args.library_id:
        try:
            UUID(args.library_id)
        except ValueError:
            parser.error("--library-id debe ser un UUID")
    load_dotenv(Path(__file__).resolve().with_name(".env"))
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    output = (
        args.output or Path("data") / f"gmaps-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.jsonl"
    )
    driver = None
    failures = 0
    skipped = 0
    try:
        with httpx.Client(timeout=30, follow_redirects=False) as client:
            database = Supabase(
                client, os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
            )
            libraries = database.libraries()  # Validar acceso/esquema antes de abrir Chrome.
            libraries = [
                row for row in libraries if not args.library_id or row["id"] == args.library_id
            ]
            if args.limit:
                libraries = libraries[: args.limit]
            if not libraries:
                LOG.info("No hay bibliotecas seleccionadas")
                return 0
            args.profile.mkdir(parents=True, exist_ok=True)
            output.parent.mkdir(parents=True, exist_ok=True)
            with (
                (args.profile / ".biblioradar.lock").open("w") as lock,
                output.open("a", encoding="utf-8") as handle,
            ):
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                driver = VisibleMaps(args.profile, args.manual_wait)
                for library in libraries:
                    try:
                        UUID(library["id"])
                        reading = driver.read(
                            library, collect_week=library.get("historical_popularity") is None
                        )
                        handle.write(json.dumps(reading, ensure_ascii=False) + "\n")
                        handle.flush()
                        if not args.dry_run:
                            database.persist(reading)
                        LOG.info(
                            "%s: habitual=%s live=%s%s",
                            library["name"],
                            reading["usual_value"],
                            reading["live_value"],
                            " (simulación)" if args.dry_run else "",
                        )
                    except NoPopularityData as exc:
                        skipped += 1
                        handle.write(
                            json.dumps(
                                {
                                    "library_id": library["id"],
                                    "status": "skipped",
                                    "reason": "no_popularity_data",
                                    "detail": str(exc),
                                    "created_at": datetime.now(timezone.utc).isoformat(),
                                },
                                ensure_ascii=False,
                            )
                            + "\n"
                        )
                        handle.flush()
                        LOG.info("%s: omitida, %s", library.get("name", library["id"]), exc)
                    except BlockedPage as exc:
                        failures += 1
                        LOG.error("%s", exc)
                        break  # No insistir con el resto del catálogo frente a un bloqueo.
                    except Exception as exc:
                        failures += 1
                        # No imprimir respuestas, cabeceras ni URLs que incluyan credenciales.
                        LOG.warning(
                            "%s: %s; continuar con la siguiente",
                            library.get("id"),
                            type(exc).__name__,
                        )
        LOG.info(
            "Finalizado: %s omitida(s), %s fallo(s). Lecturas locales: %s",
            skipped,
            failures,
            output,
        )
        return 1 if failures else 0
    except httpx.HTTPStatusError as exc:
        LOG.error("Supabase respondió HTTP %s", exc.response.status_code)
    except Exception as exc:
        LOG.error(
            "No se pudo ejecutar: %s. %s",
            type(exc).__name__,
            str(exc)
            if isinstance(exc, ValueError)
            else "Revisa Chrome, el perfil exclusivo y las dependencias indicadas en --help",
        )
    finally:
        if driver is not None:
            try:
                driver.close()
            except Exception:
                LOG.warning("No se pudo cerrar Chrome limpiamente")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
