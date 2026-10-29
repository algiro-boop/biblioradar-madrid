#!/usr/bin/env python3
"""Apply only the official-capacities migration, using explicit admin credentials.

uv run --with httpx --with python-dotenv --with 'psycopg[binary]' \
    python scripts/apply_official_capacities.py

Reads SUPABASE_ACCESS_TOKEN or DATABASE_URL from .env. No credentials are printed.
The service-role REST key alone cannot execute DDL.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/202610290010_official_capacities.sql"


def main() -> int:
    load_dotenv(ROOT / ".env")
    sql = MIGRATION.read_text()
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    database_url = os.environ.get("DATABASE_URL")
    try:
        if token:
            host = urlsplit(os.environ["SUPABASE_URL"]).hostname or ""
            if not host.endswith(".supabase.co"):
                raise ValueError("SUPABASE_URL debe identificar el proyecto de Supabase")
            reference = host.split(".")[0]
            with httpx.Client(timeout=60) as client:
                response = client.post(
                    f"https://api.supabase.com/v1/projects/{reference}/database/query",
                    headers={"Authorization": f"Bearer {token}"},
                    json={"query": sql},
                )
                response.raise_for_status()
        elif database_url:
            import psycopg

            with psycopg.connect(database_url, sslmode="require", autocommit=True) as connection:
                connection.execute(sql)
        else:
            print("Falta DATABASE_URL o SUPABASE_ACCESS_TOKEN en .env; no se ha ejecutado SQL.")
            return 1
    except Exception as error:
        # Drivers and HTTP exceptions may contain credentials in their string form.
        print(f"No se ha podido confirmar la migración: {type(error).__name__}")
        return 1
    print(f"Migración aplicada: {MIGRATION.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
