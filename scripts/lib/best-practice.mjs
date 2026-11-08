// Deterministic checks from Anthropic's skill authoring best practices
// (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
// Only rules a script can check reliably. Zero dependencies; pure functions over file text.
import { posix } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

export const MAX_BODY_LINES = 500; // "Keep SKILL.md body under 500 lines"
export const TOC_OVER_LINES = 100; // "For reference files longer than 100 lines, include a table of contents"

export const BEST_PRACTICE_RULES = [
  { id: 'third-person', label: 'Description is written in the third person (no "I can", "You can", "I will")' },
  { id: 'what-and-when', label: 'Description says what the skill does and when to use it' },
  { id: 'body-length', label: `SKILL.md body is under ${MAX_BODY_LINES} lines` },
  { id: 'one-level-refs', label: 'References are one level deep from SKILL.md (a linked reference links to no other reference)' },
  { id: 'toc-long-refs', label: `Reference files over ${TOC_OVER_LINES} lines start with a table of contents` },
  { id: 'forward-slashes', label: 'File paths use forward slashes (no Windows-style backslash paths)' },
  { id: 'no-time-sensitive', label: 'No time-sensitive wording ("before August 2025", "as of 2025")' },
  { id: 'no-reserved-name', label: 'Name does not contain "anthropic" or "claude"' },
];

const FIRST_SECOND_PERSON = /\b(?:I|you|we)\s+(?:can|will|could|should|may|help)\b|\b(?:I'll|I'm|you'll|we'll)\b/i;
const WHEN = /\b(?:when(?:ever)?|use (?:this skill |this |it )?(?:for|if))\b/i;
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const TIME_SENSITIVE = new RegExp(`\\b(?:before|after|until)\\s+${MONTH}\\s+(?:19|20)\\d\\d\\b|\\bas of\\s+(?:${MONTH}\\s+)?(?:19|20)\\d\\d\\b`, 'i');
// `scripts\fill.py`, `C:\x`: a backslash between path segments ending in a file extension.
const BACKSLASH_PATH = /(?:^|[\s`'"(])(?:[A-Za-z]:\\|(?:[\w.-]+\\)+[\w-]+\.[A-Za-z0-9]{1,5}\b)/m;
const MD_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const TICK_REF = /`((?:\.\/)?references\/[^`\s]+\.md)`/g;

const lineCount = (t) => (t ? t.replace(/\n$/, '').split('\n').length : 0);
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const stripFences = (md) => md.replace(/^(\s*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm, '');
const stripQuotes = (s) => s.replace(/"[^"]*"|“[^”]*”/g, '""');

/** Local .md targets a markdown file links to, resolved against its own folder (skill-relative). */
function localMdLinks(md, fromFile) {
  const dir = posix.dirname(fromFile);
  const out = new Set();
  const text = stripFences(md);
  for (const m of text.matchAll(MD_LINK)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || !target.endsWith('.md')) continue;
    out.add(posix.normalize(posix.join(dir, target)));
  }
  for (const m of text.matchAll(TICK_REF)) out.add(posix.normalize(m[1]));
  return [...out];
}

function describesWhatAndWhen(desc) {
  const m = WHEN.exec(desc);
  if (!m) return { ok: false, why: 'no "when" clause (e.g. "Use when …")' };
  const before = desc.slice(0, m.index);
  const other = desc.split(/(?<=[.!?])\s+/).filter((s) => !WHEN.test(s));
  const what = words(before.replace(/\buse( this skill| this| it)?\s*$/i, '')) >= 3 || other.some((s) => words(s) >= 3);
  return what ? { ok: true } : { ok: false, why: 'only says when to use it, not what it does' };
}

/**
 * Run every rule on one skill.
 * @param skill {{name:string, skillMd:string|null, files?:{[skillRelativePath]:string}}} files = the
 *   skill's other markdown files (references etc.), keyed by path relative to the skill folder.
 * @returns {{id, label, passed:boolean, detail:string}[]}
 */
export function checkSkill({ name, skillMd, files = {} }) {
  const fm = parseFrontmatter(skillMd ?? '');
  const desc = typeof fm.data.description === 'string' ? fm.data.description : '';
  const skillName = typeof fm.data.name === 'string' && fm.data.name ? fm.data.name : name;
  const docs = { 'SKILL.md': skillMd ?? '', ...files };
  const refs = Object.keys(files).filter((f) => f.endsWith('.md'));
  const results = {};
  const put = (id, passed, detail) => { results[id] = { passed, detail }; };

  const person = FIRST_SECOND_PERSON.exec(stripQuotes(desc));
  put('third-person', !!desc && !person, !desc ? 'no description' : person ? `description says "${person[0]}"` : 'third person');

  const ww = desc ? describesWhatAndWhen(desc) : { ok: false, why: 'no description' };
  put('what-and-when', ww.ok, ww.ok ? 'what and when' : ww.why);

  const bodyLines = lineCount(fm.body);
  put('body-length', skillMd != null && bodyLines < MAX_BODY_LINES, `${bodyLines} body lines`);

  const nested = [];
  for (const ref of localMdLinks(docs['SKILL.md'], 'SKILL.md').filter((r) => r in files)) {
    for (const t of localMdLinks(files[ref], ref)) if (t !== ref && t !== 'SKILL.md' && t in files) nested.push(`${ref} → ${t}`);
  }
  put('one-level-refs', !nested.length, nested.length ? `nested: ${nested.join(', ')}` : 'one level');

  const noToc = refs.filter((f) => lineCount(files[f]) > TOC_OVER_LINES)
    .filter((f) => !/^#{1,6}\s+(?:table of\s+)?contents\b/im.test(files[f]) && (files[f].match(/\]\(#[^)]+\)/g) ?? []).length < 3);
  put('toc-long-refs', !noToc.length, noToc.length ? `no table of contents: ${noToc.join(', ')}` : 'ok');

  const slash = Object.entries(docs).filter(([, t]) => BACKSLASH_PATH.test(t)).map(([f]) => f);
  put('forward-slashes', !slash.length, slash.length ? `backslash path in ${slash.join(', ')}` : 'ok');

  const dated = Object.entries(docs).map(([f, t]) => [f, TIME_SENSITIVE.exec(stripFences(t))]).filter(([, m]) => m);
  put('no-time-sensitive', !dated.length, dated.length ? dated.map(([f, m]) => `${f}: "${m[0]}"`).join(', ') : 'ok');

  const reserved = /anthropic|claude/i.exec(skillName ?? '');
  put('no-reserved-name', !reserved, reserved ? `name contains "${reserved[0].toLowerCase()}"` : 'ok');

  return BEST_PRACTICE_RULES.map((r) => ({ ...r, ...results[r.id] }));
}

/**
 * Score = share of (skill × rule) checks passed, 0–100; null when there are no skills.
 * @returns {{score:number|null, passed:number, total:number, detail:string, failures:{skill,id,detail}[]}}
 */
export function bestPracticeScore(skills) {
  const failures = [];
  let passed = 0, total = 0;
  for (const s of skills) {
    for (const r of checkSkill(s)) {
      total++;
      if (r.passed) passed++;
      else failures.push({ skill: s.name, id: r.id, detail: r.detail });
    }
  }
  const score = total ? Math.round((100 * passed) / total) : null;
  const detail = !total ? 'no skills'
    : `${passed}/${total} checks passed` + (failures.length ? `; ${failures.map((f) => `${f.skill}: ${f.detail}`).join('; ')}` : '');
  return { score, passed, total, detail, failures };
}
