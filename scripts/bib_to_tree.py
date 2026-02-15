#!/usr/bin/env python3
"""Convert BibTeX entries into Forester reference tree files."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Tuple, cast

try:
    import bibtexparser  # type: ignore[import]
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit(
        "bibtexparser is required. Install it with `pip install bibtexparser`."
    ) from exc


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------


def _strip_braces(value: str) -> str:
    value = value.strip()
    while value.startswith("{") and value.endswith("}") and len(value) > 1:
        value = value[1:-1].strip()
    return value


def _clean_whitespace(value: str | None) -> str:
    if not value:
        return ""
    flattened = " ".join(value.replace("\n", " ").split())
    return _strip_braces(flattened)


def _format_authors(author_field: str | None) -> str | None:
    raw = _clean_whitespace(author_field)
    if not raw:
        return None
    authors = [part.strip() for part in raw.split(" and ") if part.strip()]
    if not authors:
        return None
    return ", ".join(authors)


def _slugify(name: str) -> str:
    import re

    name = name.strip().lower()
    name = _strip_braces(name)
    name = re.sub(r"[^a-z0-9]+", "-", name)
    name = re.sub(r"-+", "-", name).strip("-")
    return name or "reference"


def _parse_month(month: str | None) -> int:
    if not month:
        return 1
    month = month.strip().lower()
    name_map = {
        "jan": 1,
        "feb": 2,
        "mar": 3,
        "apr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "aug": 8,
        "sep": 9,
        "sept": 9,
        "oct": 10,
        "nov": 11,
        "dec": 12,
    }
    if month.isdigit():
        value = int(month)
        if 1 <= value <= 12:
            return value
    return name_map.get(month[:3], 1)


def _format_date(entry: Dict[str, str]) -> str | None:
    year = _clean_whitespace(entry.get("year"))
    if not year:
        return None
    month = _parse_month(_clean_whitespace(entry.get("month")))
    day = _clean_whitespace(entry.get("day"))
    try:
        day_value = int(day) if day else 1
    except ValueError:
        day_value = 1
    day_value = min(max(day_value, 1), 31)
    return f"{int(year):04d}-{month:02d}-{day_value:02d}"


def _strip_url_command(value: str) -> str:
    trimmed = value.strip()
    if trimmed.startswith("\\url{") and trimmed.endswith("}"):
        return trimmed[5:-1].strip()
    return trimmed


def _escape_meta_value(value: str) -> str:
    return value.replace("%", r"\%")


URL_FIELDS = {"url", "howpublished", "external"}


def _meta_pairs(entry: Dict[str, str]) -> Iterable[Tuple[str, str]]:
    skip = {"title", "author", "year", "month", "day"}

    for field, value in entry.items():
        if field in skip:
            continue
        cleaned = _clean_whitespace(value)
        if cleaned:
            meta_key = "external" if field.lower() in URL_FIELDS else field
            if meta_key == "external":
                cleaned = _strip_url_command(cleaned)
            yield meta_key, _escape_meta_value(cleaned)


# ----------------------------------------------------------------------------
# Core conversion
# ----------------------------------------------------------------------------


def build_tree_content(entry: Dict[str, str]) -> str:
    title = _clean_whitespace(entry.get("title")) or "Untitled"
    lines: List[str] = [f"\\title{{{title}}}", "\\taxon{Reference}"]

    authors = _format_authors(entry.get("author"))
    if authors:
        lines.append(f"\\author/literal{{{authors}}}")

    date_value = _format_date(entry)
    if date_value:
        lines.append(f"\\date{{{date_value}}}")

    for key, value in _meta_pairs(entry):
        if value:
            lines.append(f"\\meta{{{key}}}{{{value}}}")

    lines.append("")
    return "\n".join(lines)


def convert_bibtex(source: Path, output_dir: Path, overwrite: bool) -> List[Path]:
    data = bibtexparser.loads(source.read_text())  # type: ignore[no-untyped-call]
    entries = cast(List[Dict[str, str]], data.entries)  # type: ignore[attr-defined]
    if not entries:
        raise SystemExit(f"No BibTeX entries found in {source}")

    created_paths: List[Path] = []

    for entry in entries:
        citekey = entry.get("ID") or _slugify(entry.get("title", "reference"))
        filename = f"{_slugify(citekey)}.tree"
        target = output_dir / filename
        if target.exists() and not overwrite:
            raise SystemExit(
                f"Refusing to overwrite existing file {target}. Use --overwrite to replace."
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(build_tree_content(entry))
        created_paths.append(target)

    return created_paths


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        type=Path,
        help="Path to the BibTeX (.bib) file to convert",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("trees/references"),
        help="Directory where reference tree files will be created",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing reference tree files",
    )
    return parser.parse_args(argv)


def main(argv: List[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if not args.source.is_file():
        raise SystemExit(f"BibTeX file {args.source} does not exist")

    created = convert_bibtex(args.source, args.output_dir, args.overwrite)
    for path in created:
        print(f"Created {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
