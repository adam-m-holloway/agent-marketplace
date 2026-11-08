// SKILL.md frontmatter: a small YAML subset + Agent Skills limits. Zero dependencies.
// Supported: `key: value`, single/double-quoted strings, `>`/`|` blocks, `- item` lists,
// inline `[a, b]` lists, and one level of nested `key: value` maps.
import { NAME_RE } from './plugins.mjs';

function scalar(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try { return JSON.parse(v); } catch { throw new Error(`bad double-quoted string: ${v}`); }
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) throw new Error(`bad single-quoted string: ${v}`);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => scalar(s)) : [];
  }
  return v.replace(/\s+#.*$/, '');
}

function fold(lines) {
  // `>`: single newlines become spaces, blank lines become newlines.
  let out = '';
  for (const l of lines) {
    if (l === '') out += '\n';
    else out += (out && !out.endsWith('\n') ? ' ' : '') + l;
  }
  return out;
}

/**
 * @returns {{data:object, body:string, bodyStartLine:number, error?:string}}
 */
export function parseFrontmatter(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trim() !== '---') return { data: {}, body: lines.join('\n'), bodyStartLine: 1, error: 'missing frontmatter (first line must be ---)' };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { data: {}, body: '', bodyStartLine: lines.length + 1, error: 'unterminated frontmatter (no closing ---)' };
  const body = lines.slice(end + 1).join('\n');
  const bodyStartLine = end + 2;
  const data = {};
  const fm = lines.slice(1, end);
  try {
    for (let i = 0; i < fm.length; i++) {
      const line = fm[i];
      const lineNo = i + 2;
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const m = /^([A-Za-z0-9_-]+):(?:\s+(.*)|\s*)$/.exec(line);
      if (!m) throw new Error(`line ${lineNo}: cannot parse "${line}"`);
      const key = m[1];
      const rest = (m[2] ?? '').trim();
      const indented = [];
      while (i + 1 < fm.length && (fm[i + 1].trim() === '' || /^\s+/.test(fm[i + 1]))) indented.push(fm[++i]);
      while (indented.length && indented.at(-1).trim() === '') indented.pop();
      if (/^[>|][+-]?$/.test(rest)) {
        const ind = Math.min(...indented.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
        const block = indented.map((l) => (l.trim() ? l.slice(ind) : ''));
        data[key] = rest[0] === '>' ? fold(block) : block.join('\n');
      } else if (rest === '' && indented.length) {
        const items = indented.filter((l) => l.trim());
        if (items.every((l) => /^\s+-\s/.test(l) || /^\s+-$/.test(l))) {
          data[key] = items.map((l) => scalar(l.replace(/^\s+-\s?/, '')));
        } else {
          const obj = {};
          for (const l of items) {
            const mm = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(l);
            if (!mm) throw new Error(`line ${lineNo}: unsupported nested value under "${key}"`);
            obj[mm[1]] = scalar(mm[2]);
          }
          data[key] = obj;
        }
      } else {
        if (indented.some((l) => l.trim())) throw new Error(`line ${lineNo}: unexpected indented lines after "${key}"`);
        data[key] = scalar(rest);
      }
    }
  } catch (e) {
    return { data, body, bodyStartLine, error: e.message };
  }
  return { data, body, bodyStartLine };
}

/** Agent Skills limits. Returns human-readable problems (empty = OK). */
export function checkSkillFrontmatter(data, folderName) {
  const errs = [];
  const { name, description, compatibility } = data ?? {};
  if (typeof name !== 'string' || !name) errs.push('name is required');
  else {
    if (name !== folderName) errs.push(`name "${name}" must equal the folder name "${folderName}"`);
    if (name.length > 64) errs.push(`name is ${name.length} chars (max 64)`);
    if (!NAME_RE.test(name)) errs.push(`name "${name}" must be kebab-case (a-z, 0-9, -)`);
  }
  if (typeof description !== 'string' || !description.trim()) errs.push('description is required');
  else if (description.length > 1024) errs.push(`description is ${description.length} chars (max 1024)`);
  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string') errs.push('compatibility must be a string');
    else if (compatibility.length > 500) errs.push(`compatibility is ${compatibility.length} chars (max 500)`);
  }
  return errs;
}
