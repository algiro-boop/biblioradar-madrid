"""Vectores de paridad Python → web (`web/src/lib/estimate.ts`).

Regenerar tras cambiar la estimación horaria o los horarios:
    uv run python tests/estimate_vectors.py
`tests/test_estimate_vectors.py` falla si el fichero no coincide con el motor actual.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from biblioradar.engine import MADRID, heuristic_base, library_points
from biblioradar.update_job import opening_status, published_weekend_status

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web/src/__tests__/fixtures/estimate-vectors.json"
TEXTS = ROOT / "tests/fixtures/opening_texts.json"

LIBRARIES = [
    {
        "id": "00000000-0000-0000-0000-000000000001",
        "name": "Biblioteca Aluche",
        "institution": "ayuntamiento",
        "district": "Latina",
    },
    {
        "id": "6f1c3c4e-2b1a-4d7e-9a50-3f2d1e0c9b8a",
        "name": "Biblioteca Pública Elena Fortún (Retiro)",
        "institution": "comunidad",
        "district": "Retiro",
    },
    {
        "id": "a3e5b7c9-1d2f-4a6b-8c0d-e1f2a3b4c5d6",
        "name": "Sala de estudio del Centro Cultural Galileo (Chamberí)",
        "institution": "ayuntamiento",
        "district": "Chamberí",
    },
    {
        "id": "",
        "name": "Sala de Estudios Ñandú (Moncloa - Aravaca)",
        "institution": "ucm",
        "district": "MONCLOA-ARAVACA",
    },
]
# Laborable, sábado (CEST), domingo del cambio a CET, exámenes, límites de periodo.
DAYS = ["2026-10-23", "2026-10-24", "2026-10-25", "2026-12-01", "2027-01-31", "2027-04-25"]
EXTRA_MINUTES = [0, 8 * 60 + 29, 8 * 60 + 30, 9 * 60, 14 * 60, 20 * 60 + 59, 21 * 60, 23 * 60 + 59]
REVIEWED = [
    {
        "requires_review": False,
        "timezone": "Europe/Madrid",
        "weekly": {
            **{str(d): [["09:00", "21:00"]] for d in range(1, 6)},
            "6": [["09:00", "14:00"]],
        },
    },
    {
        "requires_review": False,
        "weekly": {str(d): [["20:00", "02:00"]] for d in range(1, 8)},
        "date_overrides": {"2026-10-24": []},
    },
    {"requires_review": False, "weekly": {"1": [["9:00", "24:00"]]}},
    {"requires_review": False, "weekly": {str(d): [["8:30", "21"]] for d in range(1, 8)}},
    {"requires_review": True, "weekly": {"1": [["09:00", "21:00"]]}},
]


def ms(when: datetime) -> int:
    return int(when.timestamp() * 1000)


def build() -> dict:
    heuristic = []
    for day in DAYS:
        midnight = datetime.fromisoformat(day).replace(tzinfo=MADRID)
        for minute in sorted(set(range(0, 1440, 29)) | set(EXTRA_MINUTES)):
            # Hora de pared en Madrid: a las 02:xx del 25-10 existe dos veces; se usa la primera.
            local = midnight + timedelta(minutes=minute)
            t = local.astimezone(timezone.utc)
            for index, library in enumerate(LIBRARIES):
                for open_now in (None, True):
                    for rain in (False, True):
                        value = heuristic_base(t, rain, open_now=open_now, library=library)
                        heuristic.append([ms(t), open_now, rain, index, value])
    texts = json.loads(TEXTS.read_text(encoding="utf-8"))["texts"]
    weekend_times = [
        datetime(2026, 10, 24, h, m, tzinfo=MADRID) for h, m in ((8, 0), (9, 30), (13, 59), (17, 0))
    ] + [datetime(2026, 10, 25, h, tzinfo=MADRID) for h in (10, 12, 20)]
    weekend_times.append(datetime(2026, 10, 23, 12, tzinfo=MADRID))  # laborable: siempre None
    published = [
        [i, ms(when), published_weekend_status({"normalized_text": text}, when)]
        for i, text in enumerate(texts)
        for when in weekend_times
    ]
    reviewed_times = [
        datetime(2026, 10, d, h, m, tzinfo=MADRID)
        for d in (23, 24, 25, 26)
        for h, m in ((1, 0), (8, 59), (9, 0), (13, 59), (14, 0), (20, 59), (21, 0), (23, 30))
    ]
    reviewed = [
        [i, ms(when), opening_status(hours, when)]
        for i, hours in enumerate(REVIEWED)
        for when in reviewed_times
    ]
    points = [
        [library_points(library, weekend), weekend, index]
        for index, library in enumerate(LIBRARIES)
        for weekend in (False, True)
    ]
    return {
        "generated_by": "tests/estimate_vectors.py",
        "libraries": LIBRARIES,
        "points": points,
        "heuristic": heuristic,
        "texts": texts,
        "published": published,
        "reviewed_hours": REVIEWED,
        "reviewed": reviewed,
    }


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, separators=(",", ":")) + "\n"


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(render(), encoding="utf-8")
    print(f"{OUTPUT.relative_to(ROOT)} actualizado")
