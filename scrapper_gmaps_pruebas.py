#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["selenium>=4.30,<5"]
# ///
"""Prueba independiente de Google Maps: sin proyecto, .env ni Supabase.

    uv run scrapper_gmaps_pruebas.py --url "URL_DE_GOOGLE_MAPS"
    uv run scrapper_gmaps_pruebas.py --input bibliotecas.json --weekly
    python3 scrapper_gmaps_pruebas.py --parse-labels etiquetas.json

Copia solo este archivo a cualquier carpeta. uv instala Selenium automáticamente;
como alternativa: python3 -m pip install 'selenium>=4.30,<5'. Requiere Chrome.
Chrome visible, perfil dedicado ./chrome_profile_pruebas, resultados locales en
./resultados_gmaps/<fecha>/. La primera vez puedes resolver el consentimiento
manualmente en la ventana (120 segundos por defecto). No elude CAPTCHAs.
--weekly recorre los siete días; por defecto solo lee la hora/día actuales.
El histórico usa días ISO 1..7, hora de Madrid y null para valores ausentes.
Google publica popularidad relativa, no porcentaje certificado de asientos libres.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import logging
import random
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

LOG = logging.getLogger("gmaps_pruebas")
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
    def __init__(self, profile: Path, manual_wait: int = 0, driver_path: str | None = None):
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
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
        self.driver = webdriver.Chrome(
            options=options, service=Service(driver_path) if driver_path else Service()
        )
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
            set(
                re.findall(
                    r"[a-z0-9]+", normalized(re.sub(r"\([^)]*\)", "", library.get("name") or title))
                )
            )
            - generic
        )
        found = set(re.findall(r"[a-z0-9]+", normalized(title))) - generic
        if library.get("name") and (
            not wanted or not found or len(wanted & found) / min(len(wanted), len(found)) < 0.75
        ):
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
            "name": title,
            "url": library["google_maps_url"],
            "resolved_url": self.driver.current_url,
            "aria_labels": labels,
        }


def targets(urls: list[str], input_file: Path | None, name: str | None) -> list[dict]:
    rows: list[Any] = list(urls)
    if input_file:
        payload = json.loads(input_file.read_text(encoding="utf-8-sig"))
        if not isinstance(payload, list):
            raise ValueError("--input debe contener una lista JSON de URLs u objetos {url, name}")
        rows.extend(payload)
    if not rows:
        raise ValueError("Indica --url, una URL posicional o --input bibliotecas.json")
    if name and len(rows) != 1:
        raise ValueError("--name solo puede usarse con una URL; para varias usa --input")
    result = []
    seen = set()
    for row in rows:
        if isinstance(row, str):
            url, expected_name = row, name
        elif isinstance(row, dict):
            url = row.get("url") or row.get("google_maps_url")
            expected_name = name or row.get("name")
        else:
            raise ValueError("Cada entrada debe ser una URL o un objeto {url, name}")
        url = valid_maps_url(url)
        if expected_name is not None and (
            not isinstance(expected_name, str) or not expected_name.strip()
        ):
            raise ValueError("name debe ser un texto no vacío")
        if url in seen:
            continue
        seen.add(url)
        result.append({"id": str(uuid4()), "name": expected_name, "google_maps_url": url})
    return result


def diagnostics(browser: VisibleMaps, destination: Path) -> None:
    """Diagnóstico local, incluso si las etiquetas actuales de Google cambian de formato."""
    try:
        labels = [
            label
            for element in browser.driver.find_elements(browser.by.CSS_SELECTOR, "[aria-label]")
            if element.is_displayed()
            and (label := element.get_attribute("aria-label"))
            and (BUSY.search(normalized(label)) or PERCENT.search(label))
        ]
        destination.with_suffix(".json").write_text(
            json.dumps(
                {
                    "url": browser.driver.current_url,
                    "title": browser.driver.title,
                    "aria_labels": labels,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        browser.driver.save_screenshot(str(destination.with_suffix(".png")))
    except Exception:
        LOG.warning("No se pudo guardar el diagnóstico del navegador")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("urls", nargs="*", help="URLs de fichas concretas de Google Maps")
    parser.add_argument("--url", action="append", default=[], help="URL de Maps; se puede repetir")
    parser.add_argument("--name", help="Nombre esperado opcional, para comprobar una sola ficha")
    parser.add_argument("--input", type=Path, help="JSON con lista de URLs u objetos {url, name}")
    parser.add_argument("--weekly", action="store_true", help="Intentar extraer los siete días")
    parser.add_argument("--profile", type=Path, default=Path("chrome_profile_pruebas"))
    parser.add_argument(
        "--output", type=Path, default=Path("resultados_gmaps"), help="Carpeta para resultados"
    )
    parser.add_argument(
        "--driver", type=Path, help="ChromeDriver explícito; por defecto Selenium Manager"
    )
    parser.add_argument(
        "--manual-wait", type=int, default=120, help="Espera para consentimiento/CAPTCHA manual"
    )
    parser.add_argument(
        "--debug", action="store_true", help="Guardar captura y etiquetas de cada ficha"
    )
    parser.add_argument(
        "--parse-labels", type=Path, help="Prueba offline de etiquetas JSON, sin Chrome/Selenium"
    )
    args = parser.parse_args(argv)
    if args.manual_wait < 0:
        parser.error("--manual-wait debe ser no negativo")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.parse_labels:
        try:
            payload = json.loads(args.parse_labels.read_text(encoding="utf-8-sig"))
            labels = payload.get("aria_labels") if isinstance(payload, dict) else payload
            if not isinstance(labels, list) or any(not isinstance(label, str) for label in labels):
                raise ValueError(
                    "Se requiere una lista de etiquetas de texto o {aria_labels: [...]}"
                )
            hours, live = daily_values(labels)
            print(json.dumps({"hours": hours, "live_value": live}, ensure_ascii=False, indent=2))
            return 0
        except (ValueError, OSError) as exc:
            LOG.error("No se pudieron leer las etiquetas: %s", exc)
            return 1
    try:
        libraries = targets(args.urls + args.url, args.input, args.name)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    output = args.output / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    records = []
    started = datetime.now(timezone.utc).isoformat()
    failures, skipped, blocked = 0, 0, False
    browser = None
    try:
        output.mkdir(parents=True, exist_ok=True)
        args.profile.mkdir(parents=True, exist_ok=True)
        with (args.profile / ".biblioradar.lock").open("w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("Este perfil ya está en uso por otra prueba") from None
            try:
                browser = VisibleMaps(
                    args.profile,
                    args.manual_wait,
                    str(args.driver.resolve()) if args.driver else None,
                )
                with (output / "lecturas.jsonl").open("a", encoding="utf-8") as handle:
                    for index, library in enumerate(libraries, 1):
                        stop = False
                        try:
                            record = browser.read(library, collect_week=args.weekly)
                            record["status"] = "ok"
                            LOG.info(
                                "%s: habitual=%s; en vivo=%s",
                                record["name"],
                                record["usual_value"],
                                record["live_value"],
                            )
                        except NoPopularityData as exc:
                            skipped += 1
                            record = {
                                "id": str(uuid4()),
                                "library_id": library["id"],
                                "name": library["name"],
                                "url": library["google_maps_url"],
                                "status": "skipped",
                                "reason": "no_popularity_data",
                                "detail": str(exc),
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            }
                            LOG.info("Ficha %s: omitida, %s", index, exc)
                        except Exception as exc:
                            failures += 1
                            stop = isinstance(exc, BlockedPage)
                            blocked = blocked or stop
                            record = {
                                "id": str(uuid4()),
                                "library_id": library["id"],
                                "name": library["name"],
                                "url": library["google_maps_url"],
                                "status": "blocked" if stop else "error",
                                "error_type": type(exc).__name__,
                                "error": str(exc)[:1000],
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            }
                            LOG.warning("Ficha %s: %s", index, record["error"])
                        if args.debug:
                            diagnostics(browser, output / f"diagnostico-{index:03d}")
                        records.append(record)
                        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                        handle.flush()
                        if stop:
                            break
            finally:
                if browser is not None:
                    try:
                        browser.close()
                    except Exception:
                        LOG.warning("Chrome no se cerró limpiamente")
    except Exception as exc:
        failures += 1
        LOG.error("No se pudo iniciar la prueba: %s", str(exc)[:1000])
    finally:
        if output.is_dir():
            summary = {
                "started_at": started,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "requested": len(libraries),
                "processed": len(records),
                "failures": failures,
                "skipped": skipped,
                "blocked": blocked,
                "results": records,
            }
            (output / "resumen.json").write_text(
                json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
    LOG.info("Resultados locales: %s", output.resolve())
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
