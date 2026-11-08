// Dangerous-pattern and prompt-injection rules from rules/patterns.json (loaded from the scripts'
// own repo — in CI the base branch — so a PR cannot weaken the rules it is judged by).
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { f, loadOwnJson } from './_util.mjs';

const ID = 'patterns';

export function loadPatterns() {
  const cfg = loadOwnJson('rules/patterns.json');
  return {
    extensions: cfg.extensions,
    rules: cfg.rules.map((r) => ({ ...r, re: new RegExp(r.pattern, r.flags ?? '') })),
  };
}

/** Scan text line by line. Each finding's message starts with the pattern id. */
export function scanText(text, file, cfg = loadPatterns()) {
  const out = [];
  for (const [i, line] of text.split('\n').entries()) {
    for (const r of cfg.rules) {
      if (r.re.test(line)) out.push(f(ID, r.severity, file, `${r.id}: ${r.description}`, i + 1));
    }
  }
  return out;
}

export default {
  id: ID,
  group: 'security',
  run({ root, repo }) {
    const cfg = loadPatterns();
    const out = [];
    for (const p of repo.plugins) {
      for (const file of p.files) {
        if (!cfg.extensions.includes(extname(file).toLowerCase())) continue;
        out.push(...scanText(readFileSync(join(root, file), 'utf8'), file, cfg));
      }
    }
    return out;
  },
};
