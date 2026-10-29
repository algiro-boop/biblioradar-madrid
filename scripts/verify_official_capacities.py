#!/usr/bin/env python3
"""Audit reading/study seats from downloaded official sources; never writes to Supabase.

Run: uv run python scripts/verify_official_capacities.py
Only explicit, unambiguous published reading/study totals are accepted. Computer seats,
room subtotals, variable/reduced/approximate figures and auditorium capacities are not
added or used as reading capacity. Network failures remain distinguishable from absence.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import re
import unicodedata
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
DATASETS = (
    "https://datos.madrid.es/egob/catalogo/201747-0-bibliobuses-bibliotecas.json",
    "https://datos.madrid.es/egob/catalogo/217921-0-salas-estudio.json",
    "https://datos.madrid.es/dataset/200304-0-centros-culturales/resource/"
    "200304-0-centros-culturales-json/download/200304-0-centros-culturales.json",
)
DIRECTORY = "https://gestiona.comunidad.madrid/directorio_publicacion/comunidades/"
OFFICIAL_DOMAINS = (
    "madrid.es",
    "comunidad.madrid",
    "uned.es",
    "ucm.es",
    "leganes.org",
    "rivasciudad.es",
)
# The requested numeric-first pattern also records computer seats, without assigning
# those to capacity. Label-first forms occur in the actual municipal data.
NUMBER_FIRST = re.compile(
    r"(?<![\d.,])(\d+)\s*puestos\s*de\s*(lectura|estudio|inform[aá]ticos|internet)",
    re.I,
)
LABEL_FIRST = re.compile(
    r"puestos\s*de\s*(lectura|estudio|internet|inform[aá]ticos)"
    r"(?:\s*\(aforo m[aá]ximo\))?\s*:\s*(\d{1,3}(?:\.\d{3})+|\d+)\b(?![.,]\d)",
    re.I,
)
APPROXIMATE = re.compile(r"aproximad|estimad|hasta\s+\d|unos\s+\d|alrededor|m[aá]s de", re.I)
VARIABLE = re.compile(
    r"reducid|laborables|s[aá]bado|domingo|\bentre\s+\d|\b\d+\s*(?:y|o|a|[-–])\s*\d+",
    re.I,
)
GENERIC = set(
    "biblioteca bibliotecas publica publicas publico municipal municipales centro centros "
    "cultural culturales socio sociocultural socioculturales sala salas lectura estudio "
    "estudios espacio escritor del de la las el los y en un una madrid".split()
)


def normalized(value: str) -> str:
    return " ".join(
        re.findall(
            r"[a-z0-9]+",
            "".join(
                c
                for c in unicodedata.normalize("NFKD", value.casefold())
                if not unicodedata.combining(c)
            ),
        )
    )


def signature(name: str) -> set[str]:
    return set(normalized(re.sub(r"\([^)]*\)", "", name)).split()) - GENERIC


def names_match(left: str, right: str) -> bool:
    a, b = signature(left), signature(right)
    if not a or not b:
        return False
    # Do not treat a cultural centre as a neighbouring library with the same name.
    if ("biblioteca" in normalized(left).split()) != ("biblioteca" in normalized(right).split()):
        return False
    return a == b or (min(len(a), len(b)) >= 2 and (a <= b or b <= a))


class OfficialHTML(HTMLParser):
    """Visible text only: script/style/template numbers never become evidence."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.skip = 0
        self.href: str | None = None
        self.label: list[str] = []
        self.headings: list[str] = []
        self.heading: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "template", "noscript"}:
            self.skip += 1
        if self.skip:
            return
        if tag in {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "section"}:
            self.parts.append("\n")
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.label = []
        if tag in {"h1", "h2", "h3"}:
            self.heading = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "template", "noscript"}:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag == "a" and self.href is not None:
            self.links.append((self.href, "".join(self.label).strip()))
            self.href = None
        if tag in {"h1", "h2", "h3"} and self.heading is not None:
            self.headings.append("".join(self.heading).strip())
            self.heading = None
        if tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "section"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)
            if self.href is not None:
                self.label.append(data)
            if self.heading is not None:
                self.heading.append(data)

    @property
    def text(self) -> str:
        # Whitespace is preserved: evidence is a literal substring of this decoded
        # text, whose original HTTP bytes are archived alongside the audit.
        return "".join(self.parts)


def visible_text(value: str) -> str:
    parser = OfficialHTML()
    parser.feed(value)
    return parser.text


def extract_capacity(text: str, *, study_room: bool = False) -> dict:
    matches = []
    for pattern, number_group, kind_group in ((NUMBER_FIRST, 1, 2), (LABEL_FIRST, 2, 1)):
        for match in pattern.finditer(text):
            matches.append(
                {
                    "value": int(match[number_group].replace(".", "")),
                    "kind": match[kind_group].casefold(),
                    "start": match.start(),
                    "end": match.end(),
                    "literal": match[0],
                }
            )
    # Generic aforo is accepted only for a dedicated study-room record, never a
    # cultural centre (where the number may belong to its auditorium).
    if study_room:
        for match in re.finditer(
            r"\bAforo\s*:\s*(\d+)\s*(?:puestos|plazas|personas)\b", text, re.I
        ):
            matches.append(
                {
                    "value": int(match[1]),
                    "kind": "estudio",
                    "start": match.start(),
                    "end": match.end(),
                    "literal": match[0],
                }
            )
        for match in re.finditer(
            r"\b(?:N[úu]mero|N(?:[ºo]|&(?:amp;)?ordm;))\s*de\s*(?:puestos|plazas)\s*:\s*(\d+)\b",
            text,
            re.I,
        ):
            matches.append(
                {
                    "value": int(match[1]),
                    "kind": "estudio",
                    "start": match.start(),
                    "end": match.end(),
                    "literal": match[0],
                }
            )
    # The regional directory explicitly labels a unique general/reading room.
    for match in re.finditer(
        r"Sala\s+(?:General\s*\([úu]nica\)|de\s+(?:lectura|estudio))"
        r"\s*:\s*Capacidad\s*:\s*(\d+)\b",
        text,
        re.I,
    ):
        # "General (única)" is a room-type label, not proof that there are no
        # other rooms in the library. Never use it if other capacities coexist.
        if len(re.findall(r"\bCapacidad\s*:", text, re.I)) == 1:
            matches.append(
                {
                    "value": int(match[1]),
                    "kind": "lectura",
                    "start": match.start(),
                    "end": match.end(),
                    "literal": match[0],
                }
            )
    reading = [m for m in matches if m["kind"] in {"lectura", "estudio"}]
    result = {
        "capacity": None,
        "raw_evidence_text": None,
        "matches": matches,
        "reason": "no_explicit_reading_capacity",
    }
    if not reading:
        return result
    start, end = min(m["start"] for m in reading), max(m["end"] for m in reading)
    # Keep the literal sentence with qualifiers, but exclude the unrelated
    # historical prose/metro line numbers around municipal equipment fields.
    before = list(re.finditer(r"[.!?](?:\s|$)|\n", text[:start]))
    sentence_start = before[-1].end() if before else 0
    start = sentence_start if start - sentence_start <= 100 else start
    boundary = re.search(
        r"[.!?](?:\s|$)|\n|\bPuestos\s+(?:de|sala)|\bMetro\s*:|\bCercan[ií]as\s*:",
        text[end:],
        re.I,
    )
    end = end + boundary.start() if boundary else len(text)
    evidence = text[start:end].strip()
    result["raw_evidence_text"] = evidence
    if re.search(
        r"lectura\s+informal|Adapt\.discapacitados|lectura\s+(?:reservad|adaptad)", evidence, re.I
    ):
        result["reason"] = "partial_or_adapted_seats_not_total"
    elif APPROXIMATE.search(evidence) or VARIABLE.search(evidence):
        result["reason"] = "ambiguous_variable_or_approximate"
    elif len(reading) != 1 or reading[0]["value"] <= 0:
        result["reason"] = "multiple_figures_no_total_inferred"
    else:
        result.update(capacity=reading[0]["value"], reason="verified_explicit_total")
    return result


def official_url(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return urlsplit(url).scheme in {"http", "https"} and any(
        host == domain or host.endswith("." + domain) for domain in OFFICIAL_DOMAINS
    )


class Downloader:
    def __init__(self, client: httpx.AsyncClient, archive: Path) -> None:
        self.client, self.archive = client, archive
        self.semaphore = asyncio.Semaphore(4)
        self.tasks: dict[str, asyncio.Task] = {}
        self.log: list[dict] = []

    async def get(self, url: str) -> dict:
        url = url.strip()
        if url not in self.tasks:
            self.tasks[url] = asyncio.create_task(self._download(url))
        return await self.tasks[url]

    async def _download(self, url: str) -> dict:
        entry = {"requested_url": url, "url": url, "retrieved_at": datetime.now(UTC).isoformat()}
        self.log.append(entry)
        async with self.semaphore:
            try:
                current = url
                for _ in range(8):
                    if not official_url(current):
                        raise ValueError("non-official URL or redirect rejected")
                    for attempt in range(2):
                        try:
                            response = await self.client.get(current)
                            application_error = "org.apache.catalina" in response.text
                            if (
                                response.status_code in {429, 500, 502, 503, 504}
                                or application_error
                            ) and not attempt:
                                await asyncio.sleep(1)
                                continue
                            break
                        except httpx.TransportError:
                            if attempt:
                                raise
                            await asyncio.sleep(1)
                    entry.update(url=str(response.url), status=response.status_code)
                    if response.is_redirect:
                        current = urljoin(str(response.url), response.headers["location"])
                        continue
                    response.raise_for_status()
                    digest = hashlib.sha256(response.content).hexdigest()
                    filename = digest + ".response"
                    self.archive.mkdir(parents=True, exist_ok=True)
                    (self.archive / filename).write_bytes(response.content)
                    entry.update(
                        sha256=digest,
                        snapshot=filename,
                        content_type=response.headers.get("content-type", ""),
                        encoding=response.encoding,
                    )
                    if application_error:
                        entry["error"] = (
                            "Official server returned an application exception with HTTP 200"
                        )
                        return entry.copy()
                    return {**entry, "text": response.text}
                raise ValueError("too many redirects")
            except (httpx.HTTPError, ValueError, KeyError) as error:
                entry["error"] = f"{type(error).__name__}: {error}"
                return entry.copy()


async def directory_index(download: Downloader) -> list[tuple[str, str]]:
    first = await download.get(DIRECTORY + "registros.cmd")
    if "text" not in first:
        return []
    parser = OfficialHTML()
    parser.feed(first["text"])
    pages = {
        urljoin(first["url"], href) for href, _ in parser.links if "registros.cmd?posicion=" in href
    }
    documents = [first, *await asyncio.gather(*(download.get(u) for u in sorted(pages)))]
    entries = {}
    for document in documents:
        parser = OfficialHTML()
        parser.feed(document.get("text", ""))
        for href, label in parser.links:
            if re.search(r"registro\.cmd\?id=\d+", href):
                entries[urljoin(document["url"], href)] = label
    return [(name, url) for url, name in entries.items()]


def postcode(value: str) -> str | None:
    match = re.search(r"\b28\d{3}\b", value)
    return match[0] if match else None


def identity_matches(row: dict, title: str, address: str, *, known_alias: bool = False) -> bool:
    if not known_alias and not names_match(row["nombre"], title):
        return False
    expected, actual = postcode(row["direccion"]), postcode(address)
    # No geographic guessing: require a matching postcode, or street tokens and
    # a street number when either source does not publish its postcode.
    if expected and actual and expected == actual:
        return True
    a, b = set(normalized(row["direccion"]).split()), set(normalized(address).split())
    numbers = {token for token in a if token.isdigit() and len(token) < 5}
    street = (a & b) - GENERIC - {"calle", "avenida", "paseo", "c", "av", "madrid"}
    return bool(numbers & b) and len({t for t in street if not t.isdigit()}) >= 2


def record_texts(record: dict) -> list[tuple[str, str]]:
    organization = record.get("organization", {})
    fields = [
        (f"organization.{key}", str(organization[key]))
        for key in ("services", "equipamiento", "organization-desc")
        if organization.get(key)
    ]
    if record.get("equipamiento"):
        fields.append(("equipamiento", str(record["equipamiento"])))
    return fields


def verify_evidence(results: list[dict], downloads: list[dict], archive: Path) -> int:
    """Fail closed unless each assigned number replays from the archived response."""
    for document in downloads:
        if document.get("snapshot"):
            raw = (archive / document["snapshot"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != document["sha256"]:
                raise ValueError("Archived HTTP response hash mismatch")
    verified = 0
    for result in results:
        if result["capacity"] is None:
            continue
        candidate = next(
            (
                c
                for c in result["evidence_candidates"]
                if c["capacity"] == result["capacity"]
                and c["source_url"] == result["source_url"]
                and c["raw_evidence_text"] == result["raw_evidence_text"]
            ),
            None,
        )
        if candidate is None:
            raise ValueError(f"Missing evidence candidate: {result['name']}")
        document = next(
            d
            for d in downloads
            if d.get("sha256") == candidate["sha256"] and d["url"] == candidate["source_url"]
        )
        raw = (archive / candidate["snapshot"]).read_bytes().decode(document["encoding"])
        study_room = False
        if candidate["field"] == "visible_html_text":
            original = visible_text(raw).split("Datos básicos", 1)[-1].split("Colecciones", 1)[0]
        else:
            record = next(
                r
                for r in json.loads(raw, strict=False)["@graph"]
                if r["id"] == candidate["record_id"]
            )
            original = dict(record_texts(record))[candidate["field"]]
            study_room = normalized(record["title"]).startswith(
                ("sala ", "salas ", "espacio de lectura", "aula de estudio")
            )
        replayed = extract_capacity(original, study_room=study_room)
        if (
            candidate["raw_evidence_text"] not in original
            or replayed["capacity"] != result["capacity"]
            or replayed["raw_evidence_text"] != result["raw_evidence_text"]
        ):
            raise ValueError(f"Evidence does not replay: {result['name']}")
        verified += 1
    return verified


async def run(args: argparse.Namespace) -> list[dict]:
    rows = list(csv.DictReader(args.catalog.open(encoding="utf-8-sig")))
    if len({r["nombre"] for r in rows}) != len(rows):
        raise ValueError("duplicate catalogue names; audit aborted")
    locations = json.loads((ROOT / "data/csv/verified_locations.json").read_text())
    # Existing catalogue metadata is used ONLY for established name aliases and
    # official IDs, never for any stored total_seats/capacity field.
    metadata_rows = json.loads(args.metadata.read_text()) if args.metadata.exists() else []
    aliases = {r["name"]: str(r.get("source_id", "")) for r in metadata_rows}
    archive = args.output.parent / "capacity_sources"
    async with httpx.AsyncClient(
        timeout=25, headers={"User-Agent": "BiblioRadar-CapacityAudit/1.0"}
    ) as client:
        download = Downloader(client, archive)
        records = []
        for url in DATASETS:
            doc = await download.get(url)
            if "text" not in doc:
                continue
            try:
                # Madrid publishes unescaped newlines in some JSON strings.
                graph = json.loads(doc["text"], strict=False)["@graph"]
                records.extend((r, doc) for r in graph)
            except (ValueError, KeyError, TypeError) as error:
                doc["parse_error"] = str(error)
            print(f"Catálogo oficial: {doc['url']}", flush=True)
        directory = await directory_index(download)
        print(
            f"Catálogo local: {len(rows)} centros; índice autonómico: {len(directory)} fichas",
            flush=True,
        )

        async def audit(row: dict) -> dict:
            name = row["nombre"]
            result = {
                "name": name,
                "capacity": None,
                "raw_evidence_text": None,
                "source_url": None,
                "reason": "no_matching_official_source",
                "sources_checked": [],
            }
            candidates = []
            html_urls = []
            for record, doc in records:
                address = record.get("address", {})
                address_text = " ".join(
                    str(address.get(k, "")) for k in ("street-address", "postal-code")
                )
                known_alias = aliases.get(name) == str(record.get("id")) and (
                    "biblioteca" in normalized(name).split()
                ) == ("biblioteca" in normalized(record.get("title", "")).split())
                if not identity_matches(
                    row, record.get("title", ""), address_text, known_alias=known_alias
                ):
                    continue
                study_room = normalized(record.get("title", "")).startswith(
                    ("sala ", "salas ", "espacio de lectura", "aula de estudio")
                )
                for field, text in record_texts(record):
                    # Keep JSON strings verbatim; the raw JSON bytes and record ID
                    # disambiguate which centre a number belongs to.
                    extracted = extract_capacity(text, study_room=study_room)
                    candidates.append(
                        {
                            **extracted,
                            "source_url": doc["url"],
                            "sha256": doc["sha256"],
                            "snapshot": doc["snapshot"],
                            "record_id": record["id"],
                            "official_name": record["title"],
                            "field": field,
                            "matching_method": "existing_source_id_and_address"
                            if known_alias
                            else "name_and_address",
                        }
                    )
                if record.get("relation"):
                    html_urls.append(record["relation"].replace("http://", "https://", 1))
            # No network needed for a clear dataset total; conflicting dataset
            # figures are retained and never silently replaced by a web-page figure.
            meaningful = [c for c in candidates if c["raw_evidence_text"]]
            if not meaningful:
                urls = [url for title, url in directory if names_match(name, title)]
                known = locations.get(name, {}).get("source_url", "")
                if official_url(known):
                    urls.append(known)
                urls.extend(html_urls)
                urls = list(dict.fromkeys(urls))
                for url in urls:
                    doc = await download.get(url)
                    result["sources_checked"].append({k: v for k, v in doc.items() if k != "text"})
                    if "text" not in doc:
                        continue
                    parser = OfficialHTML()
                    parser.feed(doc["text"])
                    # Restrict directory pages to the record body, not menu links.
                    body = parser.text.split("Datos básicos", 1)[-1].split("Colecciones", 1)[0]
                    if not any(identity_matches(row, title, body) for title in parser.headings):
                        # Source URLs explicitly supplied for this exact centre
                        # still require matching the downloaded page's name/address.
                        if not (
                            names_match(
                                name, next((title for title, u in directory if u == url), "")
                            )
                            and identity_matches(row, name, body)
                        ):
                            continue
                    if url.startswith(DIRECTORY):
                        # Follow only a centre's own official page, discovered in
                        # its downloaded directory entry; never search social sites.
                        for href, _ in parser.links:
                            linked = urljoin(doc["url"], href.strip())
                            if (
                                official_url(linked)
                                and "/centros/biblioteca" in linked
                                and linked not in urls
                            ):
                                urls.append(linked)
                    extracted = extract_capacity(body)
                    candidates.append(
                        {
                            **extracted,
                            "source_url": doc["url"],
                            "sha256": doc["sha256"],
                            "snapshot": doc["snapshot"],
                            "field": "visible_html_text",
                        }
                    )
            meaningful = [c for c in candidates if c["raw_evidence_text"]]
            result["evidence_candidates"] = meaningful
            verified = [c for c in meaningful if c["capacity"] is not None]
            if (
                verified
                and len({c["capacity"] for c in verified}) == 1
                and not any(c["reason"] == "ambiguous_variable_or_approximate" for c in meaningful)
            ):
                result.update(
                    {
                        k: verified[0][k]
                        for k in (
                            "capacity",
                            "raw_evidence_text",
                            "source_url",
                            "sha256",
                            "snapshot",
                            "field",
                            "reason",
                        )
                    }
                )
                for key in ("record_id", "official_name", "matching_method"):
                    if key in verified[0]:
                        result[key] = verified[0][key]
            elif meaningful:
                result.update(
                    raw_evidence_text=meaningful[0]["raw_evidence_text"],
                    source_url=meaningful[0]["source_url"],
                    reason="ambiguous_official_figures",
                )
            elif candidates:
                result.update(
                    source_url=candidates[0]["source_url"], reason="no_explicit_reading_capacity"
                )
            elif result["sources_checked"]:
                result["reason"] = "source_unavailable_or_identity_not_confirmed"
            print(f"{name}: {result['capacity']} ({result['reason']})", flush=True)
            return result

        results = await asyncio.gather(*(audit(row) for row in rows))
        replayed = verify_evidence(results, download.log, archive)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        metadata = {
            "retrieved_at": datetime.now(UTC).isoformat(),
            "catalogue_count": len(rows),
            "catalogue_sha256": hashlib.sha256(args.catalog.read_bytes()).hexdigest(),
            "alias_metadata_sha256": hashlib.sha256(args.metadata.read_bytes()).hexdigest()
            if args.metadata.exists()
            else None,
            "replayed_evidence_count": replayed,
            "verified": sum(r["capacity"] is not None for r in results),
            "null": sum(r["capacity"] is None for r in results),
            "method": "Explicit reading/study totals only; no sums, estimates, or database writes.",
            "downloads": download.log,
        }
        args.output.with_suffix(".sources.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n"
        )
        print(
            f"\nTOTAL: {len(rows)} | VERIFICADAS: {metadata['verified']} | NULL: {metadata['null']}"
        )
        return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog", type=Path, default=ROOT / "data/csv/bibliotecas_madrid_popular_times.csv"
    )
    parser.add_argument(
        "--output", type=Path, default=ROOT / "data/csv/verified_capacities_audit.json"
    )
    parser.add_argument(
        "--metadata",
        type=Path,
        default=ROOT / "data/catalog_before_97.json",
        help="Existing official IDs for aliases only; capacity values are ignored",
    )
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
