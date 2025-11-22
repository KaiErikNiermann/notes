#!/usr/bin/env python3
"""Utility for creating the next numbered .tree file with a current date stamp."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
import shutil
import subprocess
import re

BASE36_STEM = re.compile(r"^[0-9a-zA-Z]{4}$")
MAX_VALUE = 36**4 - 1
BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scan a tree directory, determine the next 4-digit hex filename, "
            "and create an empty .tree file that begins with a \\date command."
        )
    )
    parser.add_argument(
        "tree_dir",
        nargs="?",
        default="trees",
        help="Path to the directory that stores .tree files (default: %(default)s)",
    )
    return parser.parse_args()


def to_base36(value: int, width: int = 4) -> str:
    if value < 0:
        raise ValueError("Negative values cannot be converted to base-36")
    digits: list[str] = []
    n = value
    if n == 0:
        digits.append("0")
    else:
        while n > 0:
            n, rem = divmod(n, 36)
            digits.append(BASE36_DIGITS[rem])
    base36 = "".join(reversed(digits))
    if len(base36) > width:
        raise ValueError("Value exceeds allotted width for base-36 encoding")
    return base36.rjust(width, "0")


def find_next_stem(tree_dir: Path) -> str:
    highest = -1
    for tree_path in tree_dir.glob("*.tree"):
        stem = tree_path.stem
        if BASE36_STEM.fullmatch(stem):
            value = int(stem, 36)
            if value > highest:
                highest = value
    next_value = highest + 1
    if next_value > MAX_VALUE:
        raise ValueError("All 4-digit base-36 filenames are exhausted (zzzz reached).")
    return to_base36(next_value)


def format_date_line() -> str:
    now = datetime.now()
    return now.strftime("\\date{%Y-%m-%d}")


def create_tree_file(tree_dir: Path) -> Path:
    if not tree_dir.exists():
        raise FileNotFoundError(f"Tree directory '{tree_dir}' does not exist.")
    if not tree_dir.is_dir():
        raise NotADirectoryError(f"'{tree_dir}' is not a directory.")

    stem = find_next_stem(tree_dir)
    target = tree_dir / f"{stem}.tree"
    if target.exists():
        raise FileExistsError(f"Refusing to overwrite existing file: {target}")

    date_line = format_date_line()
    target.write_text(f"{date_line}\n\n", encoding="utf-8")
    with target.open("a", encoding="utf-8") as stream:
        stream.write("\\import{base-macros}\n\n")
    return target


def main() -> None:
    args = parse_args()
    tree_dir = Path(args.tree_dir).resolve()
    try:
        new_path = create_tree_file(tree_dir)
    except Exception as exc:  # noqa: BLE001 - report any failure to the user
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    print(f"Created {new_path}")
    code_path = shutil.which("code")
    if code_path is None:
        print(
            "Warning: Visual Studio Code CLI ('code') not found on PATH; skipping auto-open",
            file=sys.stderr,
        )
        return
    try:
        subprocess.run([code_path, str(new_path)], check=False)
    except Exception as exc:  # noqa: BLE001 - we just log and continue
        print(
            f"Warning: failed to launch VS Code for {new_path}: {exc}", file=sys.stderr
        )


if __name__ == "__main__":
    main()
