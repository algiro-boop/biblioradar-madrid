"""Reference for curve-relative forecasts; never feeds a forecast into a later forecast."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import exp, floor, isfinite, log

from biblioradar.report_priority import CommunityReport

MEMORY_SECONDS = 21600


def memory_pct(current: float, anchor_base: float, residual: float, age: float) -> int | None:
    if (
        not all(isfinite(x) for x in (current, anchor_base, residual, age))
        or not 0 <= age < MEMORY_SECONDS
    ):
        return None
    trend = min(1, max(0, current) / max(1, anchor_base)) ** 2 if residual > 0 else 1
    retention = exp(-log(2) * age / 7200) * min(1, (MEMORY_SECONDS - age) / 3600)
    return floor(max(0, min(100, current + residual * retention * trend)) + 0.5)


@dataclass(frozen=True)
class MemoryForecast:
    pct: int
    reported_at: datetime
    report_count: int


def forecast_memory(
    current: float,
    reports: list[CommunityReport],
    now: datetime,
    session_start: datetime,
    baseline: Callable[[datetime], float],
    *,
    is_open: bool = True,
) -> MemoryForecast | None:
    if (
        now.tzinfo is None
        or session_start.tzinfo is None
        or any(r.created_at.tzinfo is None for r in reports)
    ):
        raise ValueError("Timezone-aware timestamps required")
    if not is_open:
        return None
    latest: dict[str, CommunityReport] = {}
    for r in reports:
        if type(r.value) is not int or not 0 <= r.value <= 100:
            raise ValueError("Invalid report")
        if not max(session_start, now - timedelta(hours=6)) <= r.created_at <= now:
            continue
        previous = latest.get(r.device_hash)
        if previous is None or (r.created_at, r.id) > (previous.created_at, previous.id):
            latest[r.device_hash] = r
    if not latest:
        return None
    anchor = max(r.created_at for r in latest.values())
    cohort = [r for r in latest.values() if r.created_at >= anchor - timedelta(minutes=15)]
    observations = [
        (r, baseline(r.created_at), exp(-log(2) * (anchor - r.created_at).total_seconds() / 900))
        for r in cohort
    ]
    mass = sum(w for _, _, w in observations)
    anchor_base = sum(b * w for _, b, w in observations) / mass
    residual = sum((r.value - b) * w for r, b, w in observations) / mass
    pct = memory_pct(current, anchor_base, residual, (now - anchor).total_seconds())
    return MemoryForecast(pct, anchor, len(cohort)) if pct is not None else None
