// Dangerous-pattern and prompt-injection rules from rules/patterns.json (loaded from the scripts'
// own repo — in CI the base branch — so a PR cannot weaken the rules it is judged by).
// Every non-binary plugin file is scanned, whatever its extension (bin/setup, .zsh, ...).
import { f, loadOwnJson, readPluginText } from './_util.mjs';

const ID = 'patterns';

export function loadPatterns() {
  const cfg = loadOwnJson('rules/patterns.json');
  return { rules: cfg.rules.map((r) => ({ ...r, re: new RegExp(r.pattern, r.flags ?? '') })) };
}

/**
 * Scan text line by line; a line ending in a backslash is joined with the next before matching
 * (shell continuation), and findings report the first line. Each message starts with the pattern id.
 */
export function scanText(text, file, cfg = loadPatterns()) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let line = lines[i];
    while (/\\\r?$/.test(line) && i + 1 < lines.length) line = line.replace(/\\\r?$/, ' ') + lines[++i];
    for (const r of cfg.rules) {
      if (r.re.test(line)) out.push(f(ID, r.severity, file, `${r.id}: ${r.description}`, start + 1));
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
        const text = readPluginText(root, file);
        if (text !== null) out.push(...scanText(text, file, cfg));
      }
    }
    return out;
  },
};
