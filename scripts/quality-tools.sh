#!/usr/bin/env bash
# Run the static quality tools over every plugin and save their raw reports for scores.mjs:
#   <out>/skill-check/<plugin>.json   skill-check (npm, JSON)
#   <out>/skillscore/<plugin>.json    skillscore (pub.dev, JSON, --target claude)
#   <out>/markdownlint/<plugin>.txt   markdownlint-cli2 (npm, one finding per line)
#   <out>/lychee/<plugin>.json        lychee --offline (local/relative links only, JSON)
#   <out>/cspell/<plugin>.txt         cspell (npm, one unknown word per line)
# Usage: bash scripts/quality-tools.sh <out> [<repo root>]
# Each tool is optional: if it is not installed or crashes, its report is left out and the site
# shows that component as "not run" (scores.mjs re-weights the components that did run).
# Versions are pinned here and in the workflows; no package.json dependencies.
set -uo pipefail

SKILL_CHECK_VERSION="${SKILL_CHECK_VERSION:-1.2.0}"
MARKDOWNLINT_CLI2_VERSION="${MARKDOWNLINT_CLI2_VERSION:-0.24.0}"
CSPELL_VERSION="${CSPELL_VERSION:-10.4.0}"
SKILLSCORE="${SKILLSCORE:-skillscore}"
LYCHEE="${LYCHEE:-lychee}"

out=$(mkdir -p "$1" && cd "$1" && pwd)
cd "${2:-.}" || exit 2
mkdir -p "$out/skill-check" "$out/skillscore" "$out/markdownlint" "$out/lychee" "$out/cspell"

# Keep a report only when the tool produced one; an empty or failed run means "not run".
keep() { if [ -s "$1.tmp" ]; then mv "$1.tmp" "$1"; else rm -f "$1.tmp"; echo "::notice::$2: no report for $3"; fi; }

have_npx=false; command -v npx >/dev/null && have_npx=true
have_ss=false; command -v "$SKILLSCORE" >/dev/null && have_ss=true
have_ly=false; command -v "$LYCHEE" >/dev/null && have_ly=true

for dir in plugins/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  p="plugins/$name"

  if $have_npx; then
    # Findings exit non-zero but still write JSON; keep() only drops an empty report.
    npx --yes "skill-check@${SKILL_CHECK_VERSION}" check "$p" --no-security-scan --format json \
      > "$out/skill-check/$name.json.tmp" 2>/dev/null
    keep "$out/skill-check/$name.json" skill-check "$name"

    # Text output (file:line[:col] rule ...), one finding per line, on stderr. A summary line
    # "Summary: N error(s)" is always printed, so an empty file means the tool did not run.
    npx --yes "markdownlint-cli2@${MARKDOWNLINT_CLI2_VERSION}" --config .markdownlint-cli2.jsonc \
      "$p/**/*.md" "#$p/**/evals/**" > "$out/markdownlint/$name.txt.tmp" 2>&1
    grep -q '^Summary:' "$out/markdownlint/$name.txt.tmp" || : > "$out/markdownlint/$name.txt.tmp"
    keep "$out/markdownlint/$name.txt" markdownlint "$name"

    # "file:line:col - Unknown word (x)" per finding; the summary line proves it ran.
    npx --yes "cspell@${CSPELL_VERSION}" lint --config .cspell.json --no-progress --no-color \
      "$p/**/*.md" --exclude "$p/**/evals/**" > "$out/cspell/$name.txt.tmp" 2>&1
    grep -q '^CSpell: Files checked' "$out/cspell/$name.txt.tmp" || : > "$out/cspell/$name.txt.tmp"
    keep "$out/cspell/$name.txt" cspell "$name"
  fi

  if $have_ss; then
    "$SKILLSCORE" "$p" --target claude --format json --no-color > "$out/skillscore/$name.json.tmp" 2>/dev/null
    keep "$out/skillscore/$name.json" skillscore "$name"
  fi

  if $have_ly; then
    # Offline: only local files and relative links are checked; remote URLs are excluded.
    find "$p" -name '*.md' -not -path '*/evals/*' -print0 | sort -z \
      | xargs -0 "$LYCHEE" --offline --no-progress --format json --output "$out/lychee/$name.json.tmp" >/dev/null 2>&1
    keep "$out/lychee/$name.json" lychee "$name"
  fi
done
echo "quality tool reports in $out"
