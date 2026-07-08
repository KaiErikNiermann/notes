#!/usr/bin/env python3
"""
build_verso.py — drive the sidecar Lake project that elaborates Lean
snippets via Verso, then extract per-anchor HTML fragments plus
deduplicated runtime assets into the notes site.

Inputs:  lean/examples/Examples.lean (with -- ANCHOR: name regions),
         lean/manual/* (Verso book skeleton — Book.lean is regenerated here).
Outputs: build/verso/<name>.html              (per-anchor article fragments)
         output/notes/verso-assets/*          (deduplicated CSS/JS, hover JSON)
         build/verso.hash                     (cache key)

The whole pass is a no-op on a cache hit (only ~20ms hashing) so it is
safe to run on every dev-server tree rebuild.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
import sys
from pathlib import Path

from urllib.request import urlopen

from lxml import html  # type: ignore[import-untyped]

logging.basicConfig(level=logging.INFO, format="[verso] %(message)s")
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
LEAN_DIR = ROOT / "lean"
EXAMPLES_FILE = LEAN_DIR / "examples" / "Examples.lean"
MANUAL_DIR = LEAN_DIR / "manual"
BOOK_LEAN = MANUAL_DIR / "Book.lean"
HTML_OUT = MANUAL_DIR / "_out" / "html-multi"
BUILD_DIR = ROOT / "build" / "verso"
HASH_FILE = ROOT / "build" / "verso.hash"
ASSETS_OUT = ROOT / "output" / "notes" / "verso-assets"

# Verso's init script optionally calls `marked.parse(...)` to render the
# docstring markdown inside hover popovers. Verso's own HTML loads marked
# from a CDN; we vendor it under verso-assets/ instead so the site stays
# self-contained and works offline. Cached at build/marked.min.js so we
# only fetch once.
MARKED_VERSION = "11.1.1"
MARKED_URL = f"https://cdn.jsdelivr.net/npm/marked@{MARKED_VERSION}/marked.min.js"
MARKED_CACHE = ROOT / "build" / f"marked-{MARKED_VERSION}.min.js"

ANCHOR_RE = re.compile(r"^\s*--\s*ANCHOR:\s*(\S+)\s*$")
ANCHOR_END_RE = re.compile(r"^\s*--\s*ANCHOR_END:\s*(\S+)\s*$")

BOOK_LEAN_HEADER = """\
/-
GENERATED FILE — do not edit by hand.
Regenerated each build by scripts/build_verso.py from anchor regions in
lean/examples/Examples.lean. Hand-edits will be lost.
-/
import VersoManual
open Verso.Genre Manual
open Verso.Genre.Manual.InlineLean
open Verso.Code.External

set_option verso.exampleProject "../examples"
set_option verso.exampleModule "Examples"

#doc (Manual) "Snippets" =>
"""


def hash_inputs() -> str:
    """SHA-256 over the contents of all Lean source + Lake config files
    that affect Verso output, plus the resolved lake-manifest revisions."""
    h = hashlib.sha256()
    inputs = sorted(
        list(LEAN_DIR.rglob("*.lean"))
        + list(LEAN_DIR.rglob("lakefile.toml"))
        + list(LEAN_DIR.rglob("lean-toolchain"))
        + list(LEAN_DIR.rglob("lake-manifest.json")),
        key=lambda p: str(p),
    )
    # Skip generated files and lake build artifacts
    inputs = [p for p in inputs if ".lake" not in p.parts and "_out" not in p.parts and p != BOOK_LEAN]
    for p in inputs:
        h.update(str(p.relative_to(LEAN_DIR)).encode())
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0\0")
    return h.hexdigest()


def parse_anchors(source: str) -> list[tuple[str, list[str]]]:
    """Return [(name, code_lines)] in source order. Malformed anchors raise."""
    anchors: list[tuple[str, list[str]]] = []
    current: tuple[str, list[str]] | None = None
    for lineno, line in enumerate(source.splitlines(), start=1):
        if m := ANCHOR_RE.match(line):
            if current is not None:
                raise ValueError(f"line {lineno}: ANCHOR '{m.group(1)}' inside open ANCHOR '{current[0]}'")
            current = (m.group(1), [])
        elif m := ANCHOR_END_RE.match(line):
            if current is None:
                raise ValueError(f"line {lineno}: ANCHOR_END '{m.group(1)}' without open ANCHOR")
            if m.group(1) != current[0]:
                raise ValueError(f"line {lineno}: ANCHOR_END '{m.group(1)}' does not match open '{current[0]}'")
            anchors.append(current)
            current = None
        elif current is not None:
            current[1].append(line)
    if current is not None:
        raise ValueError(f"unterminated ANCHOR '{current[0]}'")
    return anchors


def heading_title(anchor: str) -> str:
    """Convert anchor_name → 'anchor name' for the Verso section heading
    (Verso's heading parser dislikes underscores). The file slug stays
    as the anchor name verbatim."""
    return anchor.replace("_", " ").replace("-", " ").strip() or anchor


def generate_book_lean(anchors: list[tuple[str, list[str]]]) -> str:
    parts: list[str] = [BOOK_LEAN_HEADER]
    for name, code in anchors:
        title = heading_title(name)
        parts.append(f"\n# {title}\n%%%\nfile := \"{name}\"\nnumber := false\n%%%\n\n")
        parts.append("```anchor " + name + "\n")
        parts.extend(line + "\n" for line in code)
        parts.append("```\n")
    return "".join(parts)


def run_lake(args: list[str]) -> None:
    log.info("$ lake %s  (cwd=%s)", " ".join(args), MANUAL_DIR.relative_to(ROOT))
    res = subprocess.run(["lake", *args], cwd=MANUAL_DIR, capture_output=True, text=True)
    if res.returncode != 0:
        log.error("lake %s failed (exit %d)", " ".join(args), res.returncode)
        sys.stderr.write(res.stdout)
        sys.stderr.write(res.stderr)
        sys.exit(res.returncode)


def extract_fragment_and_assets(anchor: str) -> tuple[str, str | None, str | None]:
    """For one anchor's emitted Verso page, return:
    - fragment HTML (just the <section> contents inside <main>)
    - shared snippet CSS (the inline <style> block, returned once and deduped by caller)
    - shared snippet init JS (the inline <script> block, returned once and deduped by caller)
    """
    page = HTML_OUT / anchor / "index.html"
    if not page.exists():
        raise FileNotFoundError(f"verso did not emit {page} for anchor '{anchor}'")
    doc = html.parse(str(page)).getroot()

    # Article body: <main> → <div class="content-wrapper"> → <section>...</section>
    sections = doc.xpath('//main//section')
    if not sections:
        raise RuntimeError(f"no <section> found in {page}")
    section = sections[0]
    # Drop the <h1> heading + permalink widget — Forester provides its own surrounding context.
    for h in section.xpath('./h1'):
        section.remove(h)
    fragment = html.tostring(section, encoding="unicode", method="html")

    # Inline style: the big <style>…</style> block in <head>
    style_el = doc.xpath('//head/style')
    style_text = style_el[0].text if style_el else None

    # Inline script: the window.onload init block (find by content marker)
    script_text: str | None = None
    for s in doc.xpath('//head/script'):
        text = s.text or ""
        if "window.onload" in text and "tippy(" in text:
            script_text = text
            break
    return fragment, style_text, script_text


def rewrite_asset_urls(text: str) -> str:
    """Rewrite Verso's relative asset URLs so they resolve under our
    verso-assets/ mount regardless of which Forester page they appear on.
    The init script's fetch needs an absolute URL (relative would resolve
    against the current page like /notes/006S/, not the site root)."""
    return (
        text
        .replace("-verso-data/", "verso-assets/-verso-data/")
        # Use the site's base-url (set by Forester as <html data-base-url="...">)
        # so the JSON loads from /notes/verso-assets/ no matter which page hosts it.
        .replace(
            'let docsJson = "-verso-docs.json";',
            'let docsJson = (document.documentElement.dataset.baseUrl || "/") + "verso-assets/-verso-docs.json";',
        )
    )


def main() -> int:
    if not EXAMPLES_FILE.exists():
        log.warning("no %s — nothing to build", EXAMPLES_FILE.relative_to(ROOT))
        return 0

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    HASH_FILE.parent.mkdir(parents=True, exist_ok=True)
    ASSETS_OUT.mkdir(parents=True, exist_ok=True)

    current_hash = hash_inputs()
    cached_hash = HASH_FILE.read_text().strip() if HASH_FILE.exists() else ""
    populated = any(BUILD_DIR.glob("*.html"))

    if current_hash == cached_hash and populated:
        log.info("cache hit (%s) — skipping lake build", current_hash[:12])
        return 0

    if not shutil.which("lake"):
        if populated:
            log.warning("lake not found, using committed fragments in %s", BUILD_DIR.relative_to(ROOT))
            return 0
        log.error("lake not found and no committed fragments — install elan or commit build/verso/")
        return 1

    anchors = parse_anchors(EXAMPLES_FILE.read_text())
    if not anchors:
        log.warning("no anchors found in %s", EXAMPLES_FILE.relative_to(ROOT))
        return 0
    log.info("found %d anchors: %s", len(anchors), ", ".join(name for name, _ in anchors))

    BOOK_LEAN.write_text(generate_book_lean(anchors))
    log.info("generated %s", BOOK_LEAN.relative_to(ROOT))

    run_lake(["build"])
    # lake exe docs writes _out/html-multi/<anchor>/index.html for each top-level Verso heading
    run_lake(["exe", "docs"])

    shared_style: str | None = None
    shared_script: str | None = None
    manifest: list[str] = []
    for name, _ in anchors:
        fragment, style, script = extract_fragment_and_assets(name)
        (BUILD_DIR / f"{name}.html").write_text(rewrite_asset_urls(fragment))
        manifest.append(name)
        if shared_style is None and style:
            shared_style = style
        if shared_script is None and script:
            shared_script = rewrite_asset_urls(script)

    (BUILD_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # Write deduplicated assets
    if shared_style:
        (ASSETS_OUT / "verso-snippet.css").write_text(shared_style)
    if shared_script:
        (ASSETS_OUT / "verso-snippet-init.js").write_text(shared_script)

    # Copy runtime files. book.css is intentionally NOT copied — we don't want
    # Verso book chrome bleeding into Forester pages; the .hl.lean styling lives
    # in the inline <style> we just extracted.
    (ASSETS_OUT / "-verso-data").mkdir(parents=True, exist_ok=True)
    for relpath in ["verso-vars.css", "-verso-docs.json"]:
        src = HTML_OUT / relpath
        if src.exists():
            shutil.copy(src, ASSETS_OUT / relpath)
    for relpath in ["popper.min.js", "tippy-bundle.umd.min.js", "tippy-border.css"]:
        src = HTML_OUT / "-verso-data" / relpath
        if src.exists():
            shutil.copy(src, ASSETS_OUT / "-verso-data" / relpath)

    # Vendor marked.min.js for docstring markdown rendering inside hovers.
    if not MARKED_CACHE.exists():
        log.info("fetching marked@%s once into %s", MARKED_VERSION, MARKED_CACHE.relative_to(ROOT))
        with urlopen(MARKED_URL, timeout=30) as resp:
            MARKED_CACHE.write_bytes(resp.read())
    shutil.copy(MARKED_CACHE, ASSETS_OUT / "marked.min.js")

    HASH_FILE.write_text(current_hash)
    log.info("wrote %d fragments, assets in %s", len(anchors), ASSETS_OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
