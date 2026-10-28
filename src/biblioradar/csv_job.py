"""Actualización bayesiana sin scraping: python -m biblioradar.csv_job [--dry-run]."""

import argparse
import logging
import os
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv

from biblioradar.ingest import request_with_retry

LOG = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    load_dotenv()
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
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
        LOG.error("Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY")
        return 1
    try:
        with httpx.Client(timeout=90, follow_redirects=False) as client:
            result = request_with_retry(
                client,
                "POST",
                url + "/rest/v1/rpc/refresh_csv_occupancy",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                json={"p_dry_run": args.dry_run},
            ).json()
            LOG.info("Actualización CSV: %s", result)
        return 0
    except httpx.HTTPStatusError as exc:
        LOG.error(
            "RPC rechazado (HTTP %s); comprueba migración y clave de servidor",
            exc.response.status_code,
        )
    except (httpx.RequestError, ValueError):
        LOG.error("No se pudo actualizar el estado bayesiano")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
