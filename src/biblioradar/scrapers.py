"""Conectores HTTP sin claves de pago. Ausencia/fallo de fuente != ocupación cero."""

from __future__ import annotations

import html
import json
import logging
import math
import re
import unicodedata
from dataclasses import dataclass, replace
from datetime import datetime

import httpx

from biblioradar.engine import MADRID, aware, percentage
from biblioradar.ingest import request_with_retry

LOG = logging.getLogger(__name__)
UCM_WIDGET = "https://dashboard.sitesandstats.com/demo/76487236"
UCM_ENGINE = "https://engine3.sitesandstats.com/url_interface.php"
GOOGLE = "https://www.google.com"
# Consentimiento europeo ya resuelto: sin SOCS, /maps redirige a consent.google.com.
GOOGLE_COOKIES = {"SOCS": "CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVzIAEaBgiAo_CmBg"}
# httpx 0.28 desaconseja cookies= por petición; como cabecera solo viaja a Google y httpx
# la descarta en las redirecciones.
GOOGLE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; BiblioRadar/0.2)",
    "Accept-Language": "es-ES,es;q=0.9",
    "Cookie": "; ".join(f"{name}={value}" for name, value in GOOGLE_COOKIES.items()),
}
# Ficha JSON que la página de Maps enlaza para cargar el panel lateral del lugar.
PREVIEW_LINK = re.compile(r"/maps/preview/place\?[^\"'\\\s<>]+")
# Radio para aceptar un resultado de Google por nombre (no por place_id).
MATCH_RADIUS_M = 300
# Palabras genéricas que no identifican un centro concreto.
GENERIC_WORDS = frozenset(
    "biblioteca bibliotecas publica publico municipal sala salas aula espacio estudio estudios "
    "lectura trabajo centro cultural sociocultural juvenil intergeneracional dotacional "
    "integrado madrid comunidad de del la las el los y e en".split()
)
# Coletillas administrativas que el catálogo añade tras la dirección postal.
ADDRESS_NOISE = re.compile(
    r"\s+(?:junto\s+a|en\s+(?:el\s+|la\s+)?(?:c\.\s*cultural|centro|edificio|planta)|"
    r"centro\s+cultural|c\.\s*cultural|planta|esquina|acceso|entrada|antiguo|local\s+bajo)"
    r"(?![a-z0-9]).*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Observation:
    google_live_pct: int | None = None
    google_hist_pct: int | None = None
    university_live_pct: int | None = None
    # Horario estructurado de Google para hoy: True abierta, False cerrada, None desconocido.
    open_now: bool | None = None
    place_id: str | None = None
    source: str = "Sin datos de concurrencia"
    error: str | None = None

    @property
    def available(self) -> bool:
        return any(
            v is not None
            for v in (self.google_live_pct, self.google_hist_pct, self.university_live_pct)
        )


def text_key(text: str) -> str:
    return " ".join(
        re.findall(
            r"[a-z0-9]+",
            unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower(),
        )
    )


def nested(value, *indices):
    for index in indices:
        if not isinstance(value, list) or len(value) <= index:
            return None
        value = value[index]
    return value


def arrays(root, depth=0):
    """Recorrer solo datos JSON; nunca ejecutar JavaScript de una fuente remota."""
    if depth > 40:
        return
    if isinstance(root, str) and root.startswith(")]}'"):
        try:
            yield from arrays(json.loads(root[4:].lstrip()), depth + 1)
        except ValueError:
            return
    if isinstance(root, list):
        yield root
        for item in root:
            yield from arrays(item, depth + 1)


def distance(lat: float, lng: float, other_lat: float, other_lng: float) -> float:
    a = (
        math.sin(math.radians(other_lat - lat) / 2) ** 2
        + math.cos(math.radians(lat))
        * math.cos(math.radians(other_lat))
        * math.sin(math.radians(other_lng - lng) / 2) ** 2
    )
    return 6371000 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


def place_name(text: str) -> str:
    # El catálogo añade el distrito entre paréntesis; Maps normalmente lo omite.
    return text_key(re.sub(r"\([^)]*\)", "", text))


def distinctive_tokens(text: str) -> frozenset[str]:
    return frozenset(t for t in place_name(text).split() if t not in GENERIC_WORDS)


# Un resultado con nombre no idéntico debe ser, al menos, un centro de lectura o estudio.
VENUE_WORDS = frozenset("biblioteca bibliotecas sala salas aula estudio estudios lectura".split())
BUILDING_WORDS = frozenset("cultural sociocultural intergeneracional juvenil dotacional".split())


def name_score(wanted: str, candidate: str) -> float:
    """1.0 nombre idéntico; 0..1 solapamiento de palabras distintivas; 0 sin relación."""
    if place_name(wanted) == place_name(candidate):
        return 1.0
    words = set(place_name(candidate).split())
    # Excepción: Maps nombra el edificio que contiene la sala ("Centro Cultural Municipal
    # Galileo" para "Sala de estudio del Centro Cultural Galileo").
    same_building = BUILDING_WORDS & words & set(place_name(wanted).split())
    if not VENUE_WORDS & words and not same_building:
        return 0.0
    a, b = distinctive_tokens(wanted), distinctive_tokens(candidate)
    common = a & b
    if not common or (len(common) == 1 and len(next(iter(common))) < 4):
        # Una sola palabra corta ("san", "rio") no basta para identificar un centro.
        return 0.0
    overlap = len(common) / min(len(a), len(b))
    return overlap * 0.99 if overlap >= 0.75 else 0.0


def clean_query(library: dict) -> str:
    """Nombre sin distrito y dirección sin coletillas ("JUNTO A...", "EN C. CULTURAL...")."""
    name = " ".join(re.sub(r"\([^)]*\)", " ", library["name"]).split())
    address = " ".join(re.sub(r"\([^)]*\)", " ", library.get("address") or "").split())
    address = ADDRESS_NOISE.sub("", address).strip(" ,.-")
    return " ".join(part for part in (name, address, "Madrid") if part)


def parse_open_now(item: list, now: datetime) -> bool | None:
    """Lee el horario por fechas de la ficha (índice 203). Nunca deduce cierre si falta."""
    days = nested(item, 203, 0)
    if not isinstance(days, list):
        return None
    local = aware(now).astimezone(MADRID)
    today = [local.year, local.month, local.day]
    current = local.hour * 60 + local.minute
    for day in days:
        if nested(day, 2) != today:
            continue
        slots = nested(day, 3)
        if not isinstance(slots, list):
            return None
        intervals = []
        for slot in slots:
            times = nested(slot, 1)
            if not isinstance(times, list) or len(times) != 2:
                continue
            start, end = times
            if not (isinstance(start, list) and isinstance(end, list) and start and end):
                return None
            hm = [(x[0], x[1] if len(x) > 1 else 0) for x in (start, end)]
            if not all(type(h) is int and type(m) is int for h, m in hm):
                return None
            start_m, end_m = (h * 60 + m for h, m in hm)
            intervals.append((start_m, end_m if end_m > start_m else end_m + 1440))
        if intervals:
            return any(start <= current < end for start, end in intervals)
        labels = " ".join(str(nested(slot, 0)) for slot in slots)
        return False if "cerrad" in text_key(labels) else None
    return None


def is_week(value) -> bool:
    """Gráfica de afluencia: 7 días ISO [día 1..7, [[hora 0..23, % 0..100, ...], ...] | None]."""
    if not isinstance(value, list) or len(value) != 7:
        return False
    days, hours = set(), 0
    for day in value:
        number, slots = nested(day, 0), nested(day, 1)
        if type(number) is not int or not 1 <= number <= 7 or number in days:
            return False
        days.add(number)
        if slots is None:
            continue  # Día cerrado o sin datos.
        if not isinstance(slots, list):
            return False
        for slot in slots:
            hour, pct = nested(slot, 0), nested(slot, 1)
            if type(hour) is not int or type(pct) is not int:
                return False
            if not (0 <= hour <= 23 and 0 <= pct <= 100):
                return False
            hours += 1
    return hours > 0


def popularity(item: list) -> tuple[list | None, int | None]:
    """Gráfica semanal y % actual de una ficha, estén donde estén.

    Históricamente el bloque era item[84] = [semana, ..., [texto, % actual] en la posición 7].
    Google mueve los índices sin aviso, así que se busca la forma de los datos en todo el
    árbol de la ficha (preorden: el bloque contenedor se examina antes que la semana).
    """
    for node in arrays(item):
        if is_week(nested(node, 0)):
            live = nested(node, 7, 1)
            return node[0], live if type(live) is int and 0 <= live <= 100 else None
        if is_week(node):
            return node, None
    return None, None


def parse_google(page: str, library: dict, now: datetime) -> Observation:
    match = re.search(r"(?:window\.)?APP_INITIALIZATION_STATE\s*=\s*", page)
    if match:
        state, _ = json.JSONDecoder().raw_decode(page[match.end() :])
    elif page.lstrip().startswith(")]}'"):
        state = page.lstrip()  # /maps/preview/place: JSON con prefijo XSSI.
    else:
        # Respuesta de search?tbm=map&tch=1: envelope JSON con cadena XSSI.
        envelope, _ = json.JSONDecoder().raw_decode(page.lstrip())
        if not isinstance(envelope, dict) or not isinstance(envelope.get("d"), str):
            raise ValueError("Google no entrega un estado JSON reconocido")
        state = envelope["d"]
    candidates = []
    expected_id = library.get("google_place_id")
    for item in arrays(state):
        name, lat, lng = nested(item, 11), nested(item, 9, 2), nested(item, 9, 3)
        if (
            not isinstance(name, str)
            or type(lat) not in (int, float)
            or type(lng) not in (int, float)
        ):
            continue
        if not (
            math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180
        ):
            continue
        meters = distance(library["lat"], library["lng"], lat, lng)
        if meters >= MATCH_RADIUS_M:
            continue
        if expected_id:
            if nested(item, 78) != expected_id:
                continue
            score = 1.0
        else:
            # Maps abrevia ("Biblioteca Iván de Vargas"): basta con las palabras distintivas.
            score = name_score(library["name"], name)
            if not score:
                continue
        candidates.append((score, -meters, id(item), item))
    # Mismo lugar repetido en varios bloques de la respuesta: deduplicar por place_id.
    unique = {}
    for candidate in sorted(candidates, reverse=True):
        unique.setdefault(nested(candidate[3], 78) or candidate[2], candidate)
    ranked = sorted(unique.values(), reverse=True)
    if not ranked or (len(ranked) > 1 and ranked[0][0] == ranked[1][0]):
        raise ValueError("Google no ofrece una coincidencia única y verificable")
    item = ranked[0][3]
    week, live = popularity(item)
    local = aware(now).astimezone(MADRID)
    hist = None
    for day in week or ():
        if nested(day, 0) == local.isoweekday():
            for hour in nested(day, 1) or ():
                if nested(hour, 0) == local.hour:
                    hist = nested(hour, 1)
    place_id = nested(item, 78)
    return Observation(
        google_live_pct=live,
        google_hist_pct=hist,
        open_now=parse_open_now(item, now),
        place_id=place_id if isinstance(place_id, str) else None,
        source="Google Maps",
    )


def get_google(client: httpx.Client, library: dict, now: datetime) -> Observation:
    """Búsqueda `tbm=map`; si no trae afluencia, página de Maps y ficha `/maps/preview/place`.

    Desde 2026 la búsqueda suele omitir la gráfica de afluencia pero conserva el horario.
    La gráfica se busca por su forma en cada respuesta, no en un índice fijo.
    """
    found: Observation | None = None
    error = "Google no disponible"
    preview: str | None = None
    for step in ("search", "maps", "preview"):
        place_id = library.get("google_place_id") or (found.place_id if found else None)
        if step == "maps" and not place_id:
            continue
        if step == "preview" and not preview:
            break
        target = {**library, "google_place_id": place_id}
        query = f"place_id:{place_id}" if place_id else clean_query(library)
        if step == "preview":
            url, params = GOOGLE + preview, None
        else:
            url = f"{GOOGLE}/search" if step == "search" else f"{GOOGLE}/maps"
            params = {"q": query, "hl": "es", "ll": f"{library['lat']},{library['lng']}"}
            if step == "search":
                params |= {"tbm": "map", "tch": "1"}
        try:
            response = request_with_retry(client, "GET", url, params=params, headers=GOOGLE_HEADERS)
            if response.url.host != "www.google.com":
                raise ValueError(f"Google redirigió a {response.url.host}")
            if step == "maps":
                link = PREVIEW_LINK.search(response.text)
                preview = html.unescape(link[0]) if link else None
            observation = parse_google(response.text, target, now)
        except (httpx.HTTPError, ValueError, TypeError, RecursionError) as exc:
            error = f"Google no disponible: {type(exc).__name__}"
            continue
        if found and observation.open_now is None:
            observation = replace(observation, open_now=found.open_now)
        if observation.available:
            return observation
        found = found or observation
    return found or Observation(error=error)


def get_ucm(client: httpx.Client, library: dict) -> Observation:
    """Adaptador del widget público enlazado desde la guía UCM de María Zambrano.

    No reutiliza credenciales privadas: obtiene los parámetros efímeros del propio widget.
    Solo esta biblioteca está vinculada; otras UCM requieren un adaptador verificado.
    """
    if "maria zambrano" not in text_key(library["name"]):
        return Observation(error="Biblioteca UCM sin adaptador verificado")
    try:
        page = request_with_retry(client, "GET", UCM_WIDGET).text

        def variable(name: str) -> str:
            match = re.search(r"\bvar\s+" + name + r"\s*=\s*['\"]([^'\"]+)['\"]", page)
            if not match:
                raise ValueError("Widget UCM: configuración ausente")
            return match[1]

        if variable("urlCurl") != UCM_ENGINE:
            raise ValueError("Widget UCM: proveedor ha cambiado")
        placement = re.search(r"refreshPlacement\(\s*urlCurl\s*,\s*['\"](\d+)['\"]", page)
        if not placement:
            raise ValueError("Widget UCM: falta identificador de sala")
        payload = request_with_retry(
            client,
            "POST",
            UCM_ENGINE,
            params={"class": "selectJson"},
            json={
                "user": variable("login"),
                "ticket": variable("ticket"),
                "type": "prediction",
                "day": "1",
                "idType": "placement",
                "ids": placement[1],
            },
        ).json()
        # flowTpc es el aforo actual mostrado por el widget. hours son predicciones, no se usan.
        if payload["status"] != "OK" or str(payload["json"]["id"]) != placement[1]:
            raise ValueError("Widget UCM: respuesta no válida")
        if "maria zambrano" not in text_key(payload["json"]["name"]):
            raise ValueError("Widget UCM: biblioteca no coincide")
        live = percentage(payload["json"]["flowTpc"])
        if live is None:
            raise ValueError("Widget UCM: aforo actual ausente")
        return Observation(university_live_pct=live, source="Aforo UCM · María Zambrano")
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        return Observation(error=f"UCM no disponible: {type(exc).__name__}")


def get_observation(client: httpx.Client, library: dict, now: datetime) -> Observation:
    if library["institution"] == "ucm":
        observation = get_ucm(client, library)
        if observation.available:
            return observation
        LOG.warning("%s: %s", library["id"], observation.error)
    return get_google(client, library, now)
