#!/bin/bash

set -euo pipefail

npm install

npm run typecheck

./node_modules/.bin/esbuild \
	--minify \
	--bundle javascript-source/forester.ts \
	--sourcemap \
	--outfile=../forester.js


