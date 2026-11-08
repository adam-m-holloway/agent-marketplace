// Keep a Changelog helpers. Headings look like: "## [1.0.0] - 2026-11-08" (newest first).
const HEADING = /^##\s+\[?(\d+\.\d+\.\d+)\]?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;

/** All version headings in file order: [{version, date|null, line}] (line is 1-based). */
export function listVersions(text) {
  return String(text ?? '')
    .split('\n')
    .map((l, i) => {
      const m = HEADING.exec(l);
      return m ? { version: m[1], date: m[2] ?? null, line: i + 1 } : null;
    })
    .filter(Boolean);
}

export function hasEntry(text, version) {
  return listVersions(text).some((v) => v.version === version);
}

/** Body of a version's section (without its heading), trimmed; null when absent. */
export function getSection(text, version) {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((l) => HEADING.exec(l)?.[1] === version);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}
