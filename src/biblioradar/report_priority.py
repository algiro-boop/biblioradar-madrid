"""Raw report fusion reference; curve-relative memory is composed separately."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from math import exp, floor, log

REPORT_WEIGHT = 40
HALF_LIFE_SECONDS = 2400


@dataclass(frozen=True)
class CommunityReport:
    device_hash: str
    value: int
    created_at: datetime
    id: str = ""


@dataclass(frozen=True)
class PriorityResult:
    bayesian_pct: int
    displayed_pct: int
    active_reports_count: int
    full_reported_at: datetime | None
    confidence: float


def display_pct(bayesian: int, full_at: datetime | None, now: datetime) -> int:
    if full_at is None:
        return bayesian
    age = (now - full_at).total_seconds()
    if age < 0 or age >= 900:
        return bayesian
    if age <= 600:
        return 100
    return floor(bayesian + (100 - bayesian) * (900 - age) / 300 + 0.5)


def fuse_reports(
    prior_pct: float,
    strength: float,
    reports: list[CommunityReport],
    now: datetime,
    *,
    is_open: bool = True,
) -> PriorityResult:
    if now.tzinfo is None or any(r.created_at.tzinfo is None for r in reports):
        raise ValueError("Timezone-aware timestamps required")
    if not 0 <= prior_pct <= 100 or strength <= 0:
        raise ValueError("Invalid prior")
    if not is_open:
        return PriorityResult(0, 0, 0, None, 1)
    latest: dict[str, CommunityReport] = {}
    for report in reports:
        if type(report.value) is not int or not 0 <= report.value <= 100:
            raise ValueError("Invalid report")
        if not now - timedelta(minutes=90) <= report.created_at <= now:
            continue
        previous = latest.get(report.device_hash)
        if previous is None or (report.created_at, report.id) > (previous.created_at, previous.id):
            latest[report.device_hash] = report
    weights = [
        (r, REPORT_WEIGHT * exp(-log(2) * (now - r.created_at).total_seconds() / HALF_LIFE_SECONDS))
        for r in latest.values()
    ]
    mass = sum(w for _, w in weights)
    bayesian = floor(
        (prior_pct * strength + sum(r.value * w for r, w in weights)) / (strength + mass) + 0.5
    )
    full = [
        r for r in latest.values() if r.value == 100 and r.created_at > now - timedelta(minutes=15)
    ]
    anchor = max(full, key=lambda r: (r.created_at, r.id)) if full else None
    if anchor is not None:
        contrary = sum(
            r.value < 100 and (r.created_at, r.id) > (anchor.created_at, anchor.id)
            for r in latest.values()
        )
        if contrary >= len(full):
            anchor = None
    full_at = anchor.created_at if anchor else None
    return PriorityResult(
        bayesian,
        display_pct(bayesian, full_at, now),
        len(latest),
        full_at,
        mass / (strength + mass),
    )
