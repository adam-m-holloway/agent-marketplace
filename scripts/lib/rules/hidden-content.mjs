// Content a reviewer cannot see: invisible Unicode, HTML comments in Markdown, long base64, data: URIs.
import { f, readPluginText } from './_util.mjs';

const ID = 'hidden-content';

export const CHECKS = [
  { kind: 'unicode-tag', re: /[\u{E0000}-\u{E007F}]/u, what: 'Unicode tag character (U+E0000–E007F)' },
  { kind: 'zero-width', re: /[​-‍⁠﻿]/, what: 'zero-width character' },
  { kind: 'bidi', re: /[‪-‮⁦-⁩]/, what: 'bidirectional control character' },
  { kind: 'html-comment', re: /<!--/, what: 'HTML comment in Markdown', md: true },
  { kind: 'base64', re: /[A-Za-z0-9+/]{200,}={0,2}/, what: 'long base64 run (>=200 chars)' },
  { kind: 'data-uri', re: /\bdata:[a-z]+\/[a-z0-9.+-]+[;,]/i, what: '`data:` URI' },
];

/** Scan one file's text. Returns findings with 1-based lines. */
export function scanText(text, file) {
  const out = [];
  const isMd = /\.md$/i.test(file);
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    // A UTF-8 BOM at the very start of a file is tolerated.
    const l = i === 0 ? line.replace(/^﻿/, '') : line;
    for (const c of CHECKS) {
      if (c.md && !isMd) continue;
      const m = c.re.exec(l);
      if (m) {
        const cp = m[0].length <= 2 ? ` U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : '';
        out.push(f(ID, 'HIGH', file, `${c.kind}: ${c.what}${cp}`, i + 1));
      }
    }
  }
  return out;
}

export default {
  id: ID,
  group: 'security',
  run({ root, repo }) {
    const out = [];
    for (const p of repo.plugins) {
      for (const file of p.files) {
        const text = readPluginText(root, file);
        if (text !== null) out.push(...scanText(text, file));
      }
    }
    return out;
  },
};
