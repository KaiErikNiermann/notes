new *args:
  #!/usr/bin/env sh
  python scripts/create_tree.py "$@"

refs:
  python scripts/bib_to_tree.py references.bib --overwrite

serve: 
  npm run serve