"""Historical zone profiles inferred only from observed donor curves, never live posteriors."""

from __future__ import annotations

import math


def distance_m(a: dict, b: dict) -> float:
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlat = lat2 - lat1
    dlng = math.radians(b["lng"] - a["lng"])
    return (
        6371000
        * 2
        * math.asin(
            min(
                1,
                math.sqrt(
                    math.sin(dlat / 2) ** 2
                    + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
                ),
            )
        )
    )


def overlaps(slots: list | None, hour: int) -> bool:
    if not slots:
        return False

    def minute(value):
        h, m = map(int, value.split(":"))
        return h * 60 + m

    return any(hour * 60 < minute(end) and (hour + 1) * 60 > minute(start) for start, end in slots)


def apply_zone_profiles(rows: list[dict], catalog: list[dict], profiles: dict) -> None:
    """Recompute inferred slots on sync; closures and missing observations are distinct.

    North uses the three explicit donors. Madrid first uses observed donors in the same
    district, then the nearest Madrid donors. Closed donors never vote zero. If a target
    remains open after all donors close, use the nearest observed hour of the same day;
    only if the whole day lacks observations, use other days at that hour. Every such
    fallback is recorded, and no inferred profile is ever used as a donor.
    """
    indexed = {r["name"]: r for r in rows}
    positions = {r["id"]: r for r in catalog}
    observed = [
        r
        for r in rows
        if not r["historical_popularity"].get("provenance") and r["name"] not in profiles
    ]
    for name, config in profiles.items():
        if name not in indexed:
            raise ValueError(f"Zona sin biblioteca destino: {name}")
        target = indexed[name]
        pos = positions[target["id"]]
        if config.get("references"):
            donors = [indexed[n] for n in config["references"]]
            if any(d not in observed for d in donors):
                raise ValueError("Una curva inferida no puede ser donante")
        else:
            donors = [
                r
                for r in observed
                if positions[r["id"]].get("district")
                not in {"Alcobendas", "San Sebastián de los Reyes", "Leganés", "Rivas-Vaciamadrid"}
            ]
        donors = sorted(donors, key=lambda r: (distance_m(pos, positions[r["id"]]), r["name"]))
        used: set[str] = set()
        fallbacks = {}

        def points(day, hour):
            valid = [
                r
                for r in donors
                if overlaps(r["opening_hours"]["weekly"][day], hour)
                and r["historical_popularity"]["days"][day][f"{hour:02}"] is not None
            ]
            if not config.get("references"):
                district = [
                    r for r in valid if positions[r["id"]].get("district") == pos.get("district")
                ]
                valid = (district or valid)[: config.get("nearest", 3)]
            return [(r, r["historical_popularity"]["days"][day][f"{hour:02}"]) for r in valid]

        for day in map(str, range(1, 8)):
            for hour in range(6, 24):
                if not overlaps(target["opening_hours"]["weekly"][day], hour):
                    target["historical_popularity"]["days"][day][f"{hour:02}"] = 0.0
                    continue
                samples = points(day, hour)
                fallback = None
                if not samples:
                    for alternate in sorted(range(6, 24), key=lambda h: (abs(h - hour), h)):
                        samples = points(day, alternate)
                        if samples:
                            fallback = f"same_day_hour_{alternate:02}"
                            break
                if not samples:
                    samples = [
                        sample
                        for other in map(str, range(1, 8))
                        if other != day
                        for sample in points(other, hour)
                    ]
                    fallback = "same_hour_other_days"
                if not samples:
                    raise ValueError(
                        f"No hay observaciones para inferir {name}, día {day}, hora {hour}"
                    )
                weighted = total = 0.0
                for donor, value in samples:
                    weight = 1 / max(distance_m(pos, positions[donor["id"]]), 100)
                    weighted += weight * value
                    total += weight
                    used.add(donor["name"])
                target["historical_popularity"]["days"][day][f"{hour:02}"] = round(
                    weighted / total, 4
                )
                if fallback:
                    fallbacks[f"{day}-{hour:02}"] = fallback
        target["historical_popularity"]["provenance"] = {
            "kind": "reference_estimate",
            "zone": config["zone"],
            "references": sorted(used),
            "method": "Inverse-distance mean of observed historical profiles, masked by destination opening hours",
            "slot_fallbacks": fallbacks,
        }
