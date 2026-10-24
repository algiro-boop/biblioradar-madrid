"""Funciones puras: calendario de Madrid, base contextual y fusión equivalente a SQL."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, localcontext
from zoneinfo import ZoneInfo

from biblioradar.ingest import fold

MADRID = ZoneInfo("Europe/Madrid")


def aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Se requiere datetime con zona horaria")
    return value


def percentage(value: int | None) -> int | None:
    if value is not None and (type(value) is not int or not 0 <= value <= 100):
        raise ValueError("Porcentaje entero fuera de 0..100")
    return value


def round_pct(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def is_exam_period(day: date | datetime) -> bool:
    if isinstance(day, datetime):
        day = aware(day).astimezone(MADRID).date()
    md = (day.month, day.day)
    return md >= (11, 15) or md <= (1, 31) or (4, 25) <= md <= (6, 30)


def predict_base(
    google_live_pct: int | None,
    google_hist_pct: int | None,
    when: date | datetime,
    is_raining: bool,
) -> int | None:
    percentage(google_live_pct)
    percentage(google_hist_pct)
    if type(is_raining) is not bool:
        raise ValueError("is_raining debe ser booleano")
    if google_live_pct is not None:
        return google_live_pct
    if google_hist_pct is None:
        return None
    base = Decimal(google_hist_pct)
    if is_exam_period(when):
        base *= Decimal("1.25")
    if is_raining:
        base *= Decimal("1.10")
    return round_pct(min(Decimal(100), base))


HEURISTIC_SOURCE = "Estimación horaria + contexto Madrid"
# Curva de un día laborable fuera de exámenes (hora local, % de ocupación). Picos de mañana
# (9-14) y tarde (16-20:30) con valle a mediodía, como en las salas de estudio de Madrid.
HOURLY_CURVE = (
    (0.0, 5),
    (7.0, 5),
    (8.0, 10),
    (9.0, 30),
    (10.0, 48),
    (11.0, 58),
    (12.0, 62),
    (13.0, 60),
    (14.0, 45),
    (15.0, 40),
    (16.0, 50),
    (17.0, 58),
    (18.0, 62),
    (19.0, 57),
    (20.0, 48),
    (20.5, 38),
    (21.0, 25),
    (22.0, 12),
    (23.0, 6),
    (24.0, 5),
)
# Sin horario conocido solo se estima en la franja laborable habitual de las bibliotecas.
DEFAULT_OPEN_FROM, DEFAULT_OPEN_UNTIL = 8.5, 21.0
HEURISTIC_CAP = 90  # Una heurística nunca declara una sala llena.
CURVE_PEAK = max(value for _, value in HOURLY_CURVE)
# Distritos con más población universitaria o residencias cerca de las salas.
STUDENT_DISTRICTS = frozenset(
    fold(name)
    for name in ("Moncloa-Aravaca", "Chamberí", "Centro", "Ciudad Lineal", "Salamanca", "Retiro")
)
STUDY_ROOM = re.compile(r"\b(?:sala|salas|aula|espacio) de (?:estudios?|lectura)\b")
SPREAD = 7  # Variación estable por centro: -7..+7 puntos.


def library_points(library: Mapping, weekend: bool) -> int:
    """Puntos de ocupación que un centro suma a la curva en hora punta.

    UCM y Comunidad (grandes, se llenan antes en fin de semana) +8 o +12; sala dedicada al
    estudio o la lectura +6; distrito estudiantil +5; y una variación estable de -7 a +7
    derivada del id (SHA-256, no `hash()`, que cambia en cada proceso).
    """
    points = 0
    if library.get("institution") in ("ucm", "comunidad"):
        points += 12 if weekend else 8
    if STUDY_ROOM.search(fold(str(library.get("name") or ""))):
        points += 6
    if fold(str(library.get("district") or "")) in STUDENT_DISTRICTS:
        points += 5
    seed = str(library.get("id") or library.get("name") or "")
    digest = hashlib.sha256(seed.encode()).digest()
    return points + int.from_bytes(digest[:8], "big") % (2 * SPREAD + 1) - SPREAD


def heuristic_base(
    when: datetime,
    is_raining: bool,
    *,
    open_now: bool | None,
    library: Mapping | None = None,
) -> int | None:
    """Estimación cuando ninguna fuente da afluencia. None si está cerrada o no se puede saber.

    open_now=None (horario desconocido) solo estima de lunes a viernes, de 8:30 a 21:00.
    Con `library`, los puntos de `library_points` se aplican completos en hora punta y en
    proporción a la curva el resto del día, para no inflar aperturas y cierres.
    """
    if type(is_raining) is not bool:
        raise ValueError("is_raining debe ser booleano")
    if open_now is False:
        return None
    local = aware(when).astimezone(MADRID)
    hour = local.hour + local.minute / 60
    weekday = local.isoweekday()
    if open_now is None and (weekday >= 6 or not DEFAULT_OPEN_FROM <= hour < DEFAULT_OPEN_UNTIL):
        return None
    for (h0, v0), (h1, v1) in zip(HOURLY_CURVE, HOURLY_CURVE[1:]):
        if h0 <= hour < h1:
            base = Decimal(v0) + (Decimal(v1) - Decimal(v0)) * (
                Decimal(hour - h0) / Decimal(h1 - h0)
            )
            break
    else:  # pragma: no cover - la curva cubre 0..24
        raise ValueError("Hora fuera de la curva")
    if library is not None:
        base += base * library_points(library, weekday >= 6) / CURVE_PEAK
    exams = is_exam_period(local)
    if weekday == 6:
        base *= Decimal("0.95") if exams else Decimal("0.75")
    elif weekday == 7:
        base *= Decimal("0.90") if exams else Decimal("0.65")
    if exams:
        base *= Decimal("1.25")
    if is_raining:
        base *= Decimal("1.10")
    return max(1, min(HEURISTIC_CAP, round_pct(base)))


@dataclass(frozen=True)
class Report:
    reported_value: int
    created_at: datetime


@dataclass(frozen=True)
class Fusion:
    final_occupancy_pct: int | None
    crowd_pct: int | None
    active_reports_count: int
    crowd_confidence: Decimal


def fuse(base: int | None, reports: list[Report], now: datetime) -> Fusion:
    percentage(base)
    aware(now)
    weighted = Decimal(0)
    weight_sum = Decimal(0)
    count = 0
    anchor = None
    with localcontext() as ctx:
        ctx.prec = 28
        for report in reports:
            aware(report.created_at)
            if type(report.reported_value) is not int or report.reported_value not in (30, 75, 100):
                raise ValueError("Reporte fuera de 30, 75, 100")
            age = now.astimezone(timezone.utc) - report.created_at.astimezone(timezone.utc)
            seconds = Decimal(age.days * 86400 + age.seconds) + Decimal(age.microseconds) / 1000000
            if not 0 <= seconds <= 5400:
                continue
            weight = (-seconds / 2700).exp()
            weight_sum += weight
            if anchor is None:
                anchor = Decimal(report.reported_value)
            weighted += (Decimal(report.reported_value) - anchor) * weight
            count += 1
        if not count:
            return Fusion(base, None, 0, Decimal(0))
        # Centrar evita que el cociente de sumas casi idénticas convierta
        # 30 exacto en 29.999... y cambie un redondeo en .5.
        mean = anchor + weighted / weight_sum
        confidence = min(Decimal("0.85"), weight_sum * Decimal("0.35"))
        final = mean if base is None else mean * confidence + Decimal(base) * (1 - confidence)
        return Fusion(round_pct(final), round_pct(mean), count, confidence)
