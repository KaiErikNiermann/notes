# Suggested Commands
- Install deps: `poetry install`
- Run tests: `poetry run pytest`
- Lint: `poetry run ruff check .`
- Format check/fix: `poetry run black .`
- Run CLI: `poetry run forester-rag --help`
- Existing utility scripts (from Makefile):
  - `python scripts/create_tree.py`
  - `python3 scripts/bib_to_tree.py references.bib --overwrite`