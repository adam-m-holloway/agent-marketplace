// Minimal semver (MAJOR.MINOR.PATCH only — no pre-release tags in this marketplace).
const RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parse(v) {
  const m = typeof v === 'string' ? RE.exec(v) : null;
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

export function isValid(v) {
  return parse(v) !== null;
}

export function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) throw new Error(`invalid semver: ${!x ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  }
  return 0;
}

export function bump(v, level) {
  const p = parse(v);
  if (!p) throw new Error(`invalid semver: ${v}`);
  if (level === 'major') return `${p.major + 1}.0.0`;
  if (level === 'minor') return `${p.major}.${p.minor + 1}.0`;
  if (level === 'patch') return `${p.major}.${p.minor}.${p.patch + 1}`;
  throw new Error(`invalid bump level: ${level} (patch|minor|major)`);
}
