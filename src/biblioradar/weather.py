"""Clima actual de Madrid (lluvia continua o chubascos; nieve no cuenta como lluvia)."""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from biblioradar.engine import aware
from biblioradar.ingest import request_with_retry

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"


@dataclass(frozen=True)
class Weather:
    is_raining: bool
    observed_at: datetime


def get_weather(client: httpx.Client, now: datetime | None = None) -> Weather:
    now = aware(now or datetime.now(timezone.utc))
    payload = request_with_retry(
        client,
        "GET",
        WEATHER_URL,
        params={
            "latitude": 40.4168,
            "longitude": -3.7038,
            "current": "rain,showers",
            "timezone": "UTC",
        },
    ).json()
    try:
        current = payload["current"]
        observed = datetime.fromisoformat(current["time"])
        observed = (
            observed.replace(tzinfo=timezone.utc)
            if observed.tzinfo is None
            else observed.astimezone(timezone.utc)
        )
        values = [current["rain"], current["showers"]]
        if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in values):
            raise ValueError("Precipitación inválida")
        if not -timedelta(minutes=15) <= now - observed <= timedelta(minutes=60):
            raise ValueError("Clima caducado o fechado en el futuro")
        if any(payload["current_units"][k] != "mm" for k in ("rain", "showers")):
            raise ValueError("Unidades meteorológicas inesperadas")
    except (KeyError, TypeError) as exc:
        raise ValueError("Respuesta Open-Meteo incompleta") from exc
    return Weather(is_raining=any(v > 0 for v in values), observed_at=observed)
