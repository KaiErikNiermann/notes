# Task Completion Checklist
- Run lint and tests after changes:
  - `poetry run ruff check .`
  - `poetry run pytest`
- If touching formatting-sensitive code, run `poetry run black .`.
- Prefer non-destructive git operations and avoid reverting unrelated user changes.