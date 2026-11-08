import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEST_PRACTICE_RULES, checkSkill, bestPracticeScore } from '../scripts/lib/best-practice.mjs';

const md = (fm, body = '# Title\n\nDo the thing.\n') => `---\n${fm}\n---\n${body}`;
const GOOD = md('name: pdf-tools\ndescription: Extracts text and tables from PDF files. Use when the user works with PDFs or asks to fill a form.',
  '# PDF tools\n\nRead [the forms guide](references/forms.md) before filling forms.\n');
const ids = (r) => r.filter((x) => !x.passed).map((x) => x.id);

test('best-practice rules: a clean skill passes every rule', () => {
  const r = checkSkill({ name: 'pdf-tools', skillMd: GOOD, files: { 'references/forms.md': '# Forms\n\nFill each field.\n' } });
  assert.deepEqual(r.map((x) => x.id), BEST_PRACTICE_RULES.map((x) => x.id));
  assert.deepEqual(ids(r), []);
});

test('third person: "I can", "You can", "I will" in the description fail', () => {
  for (const d of ['I can extract PDFs. Use when asked.', 'You can use this to extract PDFs. Use when asked.', 'I will help with PDFs. Use when asked.']) {
    assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: md(`description: ${d}`) })), ['third-person'], d);
  }
});

test('what and when: both a "does" part and a "use when" part are needed', () => {
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: md('description: Extracts text and tables from PDF files.') })), ['what-and-when']);
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: md('description: Use when the user mentions PDFs.') })), ['what-and-when']);
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: md('description: Extracts PDF text whenever the user uploads a PDF.') })), []);
  // Folded block scalars are read as one string.
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: md('description: >\n  Extracts PDF text.\n  Use this skill when asked about PDFs.') })), []);
});

test('body length: 500 body lines or more fail', () => {
  const long = md('description: Extracts PDF text. Use when asked.', 'x\n'.repeat(500));
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: long })), ['body-length']);
  const ok = md('description: Extracts PDF text. Use when asked.', 'x\n'.repeat(499));
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: ok })), []);
});

test('one level deep: a reference that links to another reference fails', () => {
  const files = { 'references/forms.md': '# Forms\n\nSee [details](details.md).\n', 'references/details.md': '# Details\n' };
  const r = checkSkill({ name: 'pdf-tools', skillMd: GOOD, files });
  assert.deepEqual(ids(r), ['one-level-refs']);
  assert.match(r.find((x) => x.id === 'one-level-refs').detail, /references\/forms\.md → references\/details\.md/);
  // Links back to SKILL.md, to anchors and to the web are fine.
  const back = { 'references/forms.md': '# Forms\n\n[Back](../SKILL.md) [top](#forms) [MADR](https://adr.github.io/madr/)\n' };
  assert.deepEqual(ids(checkSkill({ name: 'pdf-tools', skillMd: GOOD, files: back })), []);
});

test('table of contents: reference files over 100 lines need one', () => {
  const long = '# Guide\n\n' + 'line\n'.repeat(120);
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: GOOD, files: { 'references/guide.md': long } })), ['toc-long-refs']);
  const withToc = '# Guide\n\n## Contents\n\n- [A](#a)\n- [B](#b)\n\n' + 'line\n'.repeat(120);
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: GOOD, files: { 'references/guide.md': withToc } })), []);
  const anchors = '# Guide\n\n- [Setup](#setup)\n- [Usage](#usage)\n- [Errors](#errors)\n\n' + 'line\n'.repeat(120);
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: GOOD, files: { 'references/guide.md': anchors } })), []);
});

test('backslash paths: Windows-style paths fail; regex escapes and markdown escapes do not', () => {
  const bad = md('description: Extracts PDF text. Use when asked.', 'Run scripts\\fill_form.py on the file.\n');
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: bad })), ['forward-slashes']);
  const ok = md('description: Extracts PDF text. Use when asked.', 'Match `\\d+` and write \\*literal\\* stars.\n');
  assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: ok })), []);
});

test('time-sensitive wording: "before August 2025" and "as of 2025" fail', () => {
  for (const t of ['Use the v1 API before August 2025.', 'As of 2025, prefer the new flag.']) {
    assert.deepEqual(ids(checkSkill({ name: 'p', skillMd: md('description: Extracts PDF text. Use when asked.', t + '\n') })), ['no-time-sensitive'], t);
  }
});

test('reserved words: names containing "anthropic" or "claude" fail', () => {
  assert.deepEqual(ids(checkSkill({ name: 'claude-pdf', skillMd: md('name: claude-pdf\ndescription: Extracts PDF text. Use when asked.') })), ['no-reserved-name']);
  assert.deepEqual(ids(checkSkill({ name: 'anthropic-x', skillMd: md('description: Extracts PDF text. Use when asked.') })), ['no-reserved-name']);
});

test('bestPracticeScore: fraction of rule checks passed across skills, with failures listed', () => {
  const good = { name: 'pdf-tools', skillMd: GOOD };
  const bad = { name: 'claude-x', skillMd: md('description: I can help.') }; // fails third-person, what-and-when, reserved
  const s = bestPracticeScore([good, bad]);
  const n = BEST_PRACTICE_RULES.length;
  assert.equal(s.total, 2 * n);
  assert.equal(s.passed, 2 * n - 3);
  assert.equal(s.score, Math.round((100 * (2 * n - 3)) / (2 * n)));
  assert.match(s.detail, /claude-x: /);
  assert.equal(bestPracticeScore([]).score, null);
});
