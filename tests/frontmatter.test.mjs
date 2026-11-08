import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, checkSkillFrontmatter } from '../scripts/lib/frontmatter.mjs';

test('frontmatter parses scalars, quotes, blocks and lists', () => {
  const md = [
    '---',
    'name: create-adr',
    'description: >',
    '  Creates an ADR.',
    '  Use when deciding.',
    "compatibility: 'Go 1.22+'",
    'quoted: "a: b \\"c\\""',
    'literal: |',
    '  line one',
    '  line two',
    'tags:',
    '  - adr',
    '  - madr',
    'inline: [a, b]',
    'metadata:',
    '  owner: team',
    '---',
    '# Title',
    '',
  ].join('\n');
  const r = parseFrontmatter(md);
  assert.equal(r.error, undefined);
  assert.equal(r.data.name, 'create-adr');
  assert.equal(r.data.description, 'Creates an ADR. Use when deciding.');
  assert.equal(r.data.compatibility, 'Go 1.22+');
  assert.equal(r.data.quoted, 'a: b "c"');
  assert.equal(r.data.literal, 'line one\nline two');
  assert.deepEqual(r.data.tags, ['adr', 'madr']);
  assert.deepEqual(r.data.inline, ['a', 'b']);
  assert.deepEqual(r.data.metadata, { owner: 'team' });
  assert.equal(r.bodyStartLine, 18);
  assert.equal(r.body, '# Title\n');
});

test('frontmatter reports missing or unterminated blocks', () => {
  assert.match(parseFrontmatter('# no fm').error, /missing/);
  assert.match(parseFrontmatter('---\nname: x\n').error, /unterminated/);
  assert.match(parseFrontmatter('---\n  bad indent\n---\n').error, /line 2/);
});

test('checkSkillFrontmatter applies Agent Skills limits', () => {
  assert.deepEqual(checkSkillFrontmatter({ name: 'a-b', description: 'd' }, 'a-b'), []);
  const errs = checkSkillFrontmatter({ name: 'Bad_Name', compatibility: 'x'.repeat(501) }, 'other');
  assert.ok(errs.some((e) => /folder/.test(e)));
  assert.ok(errs.some((e) => /kebab/.test(e)));
  assert.ok(errs.some((e) => /description/.test(e)));
  assert.ok(errs.some((e) => /compatibility/.test(e)));
  assert.ok(checkSkillFrontmatter({ name: 'a'.repeat(65), description: 'd' }, 'a'.repeat(65)).some((e) => /64/.test(e)));
  assert.ok(checkSkillFrontmatter({ name: 'a', description: 'd'.repeat(1025) }, 'a').some((e) => /1024/.test(e)));
});
