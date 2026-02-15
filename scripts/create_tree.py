#!/usr/bin/env python3
"""Utility for creating one or more numbered .tree files."""

from __future__ import annotations

import re
import shutil
import subprocess
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from string import Template
from typing import Annotated

import typer

BASE36_STEM = re.compile(r"^[0-9a-z]{4}$")
MAX_VALUE = 36**4 - 1
BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
RANGE_DELIMITER = ":"


app = typer.Typer(
    add_completion=False,
    help=(
        "Scan a tree directory, determine the next 4-digit base36 filenames, and "
        "create one or more .tree files with a date stamp."
    ),
)


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


def find_highest_stem_value(tree_dir: Path) -> int:
    values = [
        int(tree_path.stem, 36)
        for tree_path in tree_dir.glob("*.tree")
        if BASE36_STEM.fullmatch(tree_path.stem) is not None
    ]
    return max(values, default=-1)


def format_date_line() -> str:
    now = datetime.now()
    return now.strftime("\\date{%Y-%m-%d}")


def render_tree_content(title: str | None, taxon: str | None) -> str:
    lines: list[str] = [format_date_line(), "", "\\import{base-macros}", ""]
    if taxon is not None:
        lines.extend([f"\\taxon{{{taxon}}}", ""])
    if title is not None:
        lines.extend([f"\\title{{{title}}}", ""])
    return "\n".join(lines)


def create_tree_files(
    tree_dir: Path, count: int, titles: Sequence[str | None], taxon: str | None
) -> list[Path]:
    if len(titles) != count:
        raise ValueError(
            f"Expected {count} titles, but received {len(titles)} title value(s)."
        )
    if not tree_dir.exists():
        raise FileNotFoundError(f"Tree directory '{tree_dir}' does not exist.")
    if not tree_dir.is_dir():
        raise NotADirectoryError(f"'{tree_dir}' is not a directory.")

    first_value = find_highest_stem_value(tree_dir) + 1
    last_value = first_value + count - 1
    if last_value > MAX_VALUE:
        raise ValueError("All 4-digit base-36 filenames are exhausted (zzzz reached).")

    targets = [
        tree_dir / f"{to_base36(value)}.tree"
        for value in range(first_value, last_value + 1)
    ]
    existing_targets = [str(target) for target in targets if target.exists()]
    if existing_targets:
        existing_lines = "\n- ".join(existing_targets)
        raise FileExistsError(
            f"Refusing to overwrite existing file(s):\n- {existing_lines}"
        )

    created_paths: list[Path] = []
    for target, title in zip(targets, titles, strict=True):
        target.write_text(render_tree_content(title, taxon), encoding="utf-8")
        created_paths.append(target)
    return created_paths


def parse_interpolation_range(spec: str) -> tuple[int, int, int, bool]:
    cleaned_spec = spec.strip()
    if not cleaned_spec:
        raise ValueError("Interpolation range cannot be empty.")

    inclusive_stop = True
    range_payload = cleaned_spec
    if cleaned_spec[0] in {"[", "("}:
        if len(cleaned_spec) < 2:
            raise ValueError(
                "Interpolation range must include both opening and closing brackets."
            )
        opening, closing = cleaned_spec[0], cleaned_spec[-1]
        if (opening == "[" and closing != "]") or (opening == "(" and closing != ")"):
            raise ValueError(
                "Interpolation range brackets must be matched: "
                "'[start:step:stop]' or '(start:step:stop)'."
            )
        inclusive_stop = opening == "["
        range_payload = cleaned_spec[1:-1].strip()
    elif cleaned_spec[-1] in {"]", ")"}:
        raise ValueError(
            "Interpolation range brackets must wrap the entire range expression."
        )

    parts = [part.strip() for part in range_payload.split(RANGE_DELIMITER)]
    if len(parts) != 3 or any(part == "" for part in parts):
        raise ValueError(
            "Interpolation range must follow start:step:stop (for example: 1:1:7)."
        )

    try:
        start, step, stop = [int(part) for part in parts]
    except ValueError as exc:
        raise ValueError("Interpolation range values must be integers.") from exc

    if step == 0:
        raise ValueError("Interpolation step cannot be 0.")

    return start, step, stop, inclusive_stop


def expand_interpolation_values(
    start: int, step: int, stop: int, inclusive_stop: bool
) -> list[int]:
    def in_bounds(value: int) -> bool:
        if step > 0:
            return value <= stop if inclusive_stop else value < stop
        return value >= stop if inclusive_stop else value > stop

    values: list[int] = []
    current = start
    while in_bounds(current):
        values.append(current)
        current += step
    return values


def build_titles(
    count: int, interpolation_template: str | None, interpolation_range: str | None
) -> list[str | None]:
    if interpolation_template is None:
        if interpolation_range is not None:
            raise ValueError(
                "Interpolation range (--range/-r) requires --interpolate/-i."
            )
        return [None for _ in range(count)]

    values = list(range(1, count + 1))
    if interpolation_range is not None:
        parsed_range = parse_interpolation_range(interpolation_range)
        values = expand_interpolation_values(*parsed_range)

    if len(values) != count:
        raise ValueError(
            f"Interpolation produced {len(values)} value(s), but --num/-n was {count}."
        )

    normalized_template = interpolation_template.replace("{i}", "${i}")
    if "${i}" not in normalized_template and "$i" not in normalized_template:
        raise ValueError(
            "Interpolation template must include an index placeholder: "
            "'{i}' (recommended) or '$i'. "
            "If you pass '$i' in a shell command, use single quotes around the "
            "template or escape '$' as '\\$i'."
        )

    template = Template(normalized_template)
    try:
        return [template.substitute(i=str(value)) for value in values]
    except (KeyError, ValueError) as exc:
        raise ValueError(f"Invalid interpolation template: {exc}") from exc


def append_transclude_lines(
    tree_dir: Path, target_stem: str, created_stems: list[str]
) -> None:
    """Append \\transclude{} lines to a target tree file."""
    target_path = tree_dir / f"{target_stem}.tree"
    if not target_path.exists():
        raise FileNotFoundError(f"Target tree file '{target_path}' does not exist.")

    transclude_lines = [f"\\transclude{{{stem}}}" for stem in created_stems]
    content = "\n".join(transclude_lines) + "\n"

    with target_path.open("a", encoding="utf-8") as f:
        f.write(content)


def open_with_vscode(paths: Sequence[Path]) -> None:
    code_path = shutil.which("code")
    if code_path is None:
        typer.echo(
            (
                "Warning: Visual Studio Code CLI ('code') not found on PATH; "
                "skipping auto-open"
            ),
            err=True,
        )
        return
    try:
        subprocess.run([code_path, *[str(path) for path in paths]], check=False)
    except OSError as exc:
        typer.echo(
            f"Warning: failed to launch VS Code for new files: {exc}",
            err=True,
        )


@app.command()
def main(
    tree_dir: Annotated[
        Path,
        typer.Argument(
            help="Path to the directory that stores .tree files.",
        ),
    ] = Path("trees"),
    num_trees: Annotated[
        int,
        typer.Option(
            "--num",
            "-n",
            min=1,
            help="Number of tree files to create.",
        ),
    ] = 1,
    interpolation_template: Annotated[
        str | None,
        typer.Option(
            "--interpolate",
            "-i",
            help=(
                "Template for generated titles. Use '{i}' (recommended) or '$i' "
                "as the interpolation variable. When using '$i' in a shell command, "
                "use single quotes or escape '$' as '\\$i'."
            ),
        ),
    ] = None,
    interpolation_range: Annotated[
        str | None,
        typer.Option(
            "--range",
            "-r",
            help=(
                "Interpolation range in start:step:stop form. "
                "Wrap start:step:stop in square brackets for inclusive stop, "
                "(start:step:stop) for exclusive stop. "
                "Unwrapped start:step:stop is treated as inclusive."
            ),
        ),
    ] = None,
    taxon: Annotated[
        str | None,
        typer.Option(
            "--taxon",
            "-t",
            help="Taxon for the tree file, will be wrapped in \\taxon{}.",
        ),
    ] = None,
    transclude_target: Annotated[
        str | None,
        typer.Option(
            "--transclude-target",
            "-tct",
            help=(
                "Target tree file stem (e.g., '005n') to append \\transclude{} "
                "lines for each created tree file."
            ),
        ),
    ] = None,
    open_in_code: Annotated[
        bool,
        typer.Option(
            "--open/--no-open",
            help="Open created files in Visual Studio Code.",
        ),
    ] = True,
) -> None:
    resolved_tree_dir = tree_dir.resolve()
    try:
        titles = build_titles(num_trees, interpolation_template, interpolation_range)
        created_paths = create_tree_files(resolved_tree_dir, num_trees, titles, taxon)
    except (FileNotFoundError, NotADirectoryError, OSError, ValueError) as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    for created_path in created_paths:
        typer.echo(f"Created {created_path}")

    if transclude_target is not None:
        try:
            created_stems = [path.stem for path in created_paths]
            append_transclude_lines(resolved_tree_dir, transclude_target, created_stems)
            typer.echo(
                f"Appended transclude lines to {resolved_tree_dir / transclude_target}.tree"
            )
        except (FileNotFoundError, OSError) as exc:
            typer.echo(f"Error: {exc}", err=True)
            raise typer.Exit(code=1) from exc

    if open_in_code:
        open_with_vscode(created_paths)


if __name__ == "__main__":
    app()
