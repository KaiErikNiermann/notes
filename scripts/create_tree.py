#!/usr/bin/env python3
"""Utility for creating .tree files via ``forester new`` and enriching them."""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Sequence
from pathlib import Path
from string import Template
from typing import Annotated

import typer

RANGE_DELIMITER = ":"


app = typer.Typer(
    add_completion=False,
    help=(
        "Create one or more .tree files using `forester new` and optionally "
        "set a title, taxon, and other metadata."
    ),
)


def run_forester_new(forest_toml: Path = Path("forest.toml")) -> Path:
    """Call ``forester new`` and return the path of the created file."""
    result = subprocess.run(
        ["forester", "new", str(forest_toml)],
        capture_output=True,
        text=True,
        check=True,
    )
    # `forester new` emits diagnostics (warnings about unresolved identifiers,
    # config options, etc.) to stdout *before* printing the created file's path,
    # so the path is the final non-empty line rather than the whole stream.
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("`forester new` produced no output.")
    raw_path = lines[-1]
    created = Path(raw_path).resolve()
    if not created.exists():
        raise FileNotFoundError(
            f"`forester new` reported '{raw_path}' but the file does not exist."
        )
    return created


def enrich_tree_file(
    path: Path, title: str | None, taxon: str | None
) -> None:
    """Append ``\\import``, ``\\taxon``, and ``\\title`` lines to a tree file."""
    extra_lines: list[str] = ["", "\\import{base-macros}", ""]
    if taxon is not None:
        extra_lines.extend([f"\\taxon{{{taxon}}}", ""])
    if title is not None:
        extra_lines.extend([f"\\title{{{title}}}", ""])
    with path.open("a", encoding="utf-8") as f:
        f.write("\n".join(extra_lines))


def create_tree_files(
    count: int,
    titles: Sequence[str | None],
    taxon: str | None,
    forest_toml: Path = Path("forest.toml"),
) -> list[Path]:
    """Create *count* trees via ``forester new`` and enrich each one."""
    if len(titles) != count:
        raise ValueError(
            f"Expected {count} titles, but received {len(titles)} title value(s)."
        )
    created_paths: list[Path] = []
    for title in titles:
        path = run_forester_new(forest_toml)
        enrich_tree_file(path, title, taxon)
        created_paths.append(path)
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
    count: int,
    title: str | None,
    interpolation_template: str | None,
    interpolation_range: str | None,
) -> list[str | None]:
    if title is not None and interpolation_template is not None:
        raise ValueError(
            "Cannot use both --title and --interpolate/-i at the same time."
        )
    if title is not None:
        if interpolation_range is not None:
            raise ValueError(
                "Interpolation range (--range/-r) cannot be used with --title."
            )
        return [title for _ in range(count)]
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
    title: Annotated[
        str | None,
        typer.Option(
            "--title",
            help="Title for the tree file, will be wrapped in \\title{}.",
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
    try:
        titles = build_titles(num_trees, title, interpolation_template, interpolation_range)
        created_paths = create_tree_files(num_trees, titles, taxon)
    except (FileNotFoundError, NotADirectoryError, OSError, ValueError, RuntimeError) as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    for created_path in created_paths:
        typer.echo(f"Created {created_path}")

    if transclude_target is not None:
        try:
            tree_dir = created_paths[0].parent
            created_stems = [path.stem for path in created_paths]
            append_transclude_lines(tree_dir, transclude_target, created_stems)
            typer.echo(
                f"Appended transclude lines to {tree_dir / transclude_target}.tree"
            )
        except (FileNotFoundError, OSError) as exc:
            typer.echo(f"Error: {exc}", err=True)
            raise typer.Exit(code=1) from exc

    if open_in_code:
        open_with_vscode(created_paths)


if __name__ == "__main__":
    app()
