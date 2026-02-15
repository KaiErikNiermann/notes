#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/output/notes"
XSLT_PATH="${OUTPUT_DIR}/default.xsl"

if [[ ! -d "${OUTPUT_DIR}" ]]; then
  echo "[render_html] Output directory not found: ${OUTPUT_DIR}" >&2
  exit 1
fi

if [[ ! -f "${XSLT_PATH}" ]]; then
  echo "[render_html] XSLT stylesheet not found: ${XSLT_PATH}" >&2
  exit 1
fi

echo "[render_html] Rendering HTML from XML using ${XSLT_PATH}"

find "${OUTPUT_DIR}" -type f -name "index.xml" -print0 | while IFS= read -r -d '' xml_file; do
  xml_dir="$(dirname "${xml_file}")"
  html_file="${xml_dir}/index.html"
  xsltproc --nonet -o "${html_file}" "${XSLT_PATH}" "${xml_file}"
done

echo "[render_html] Done."
