import { test } from 'node:test';
import assert from 'node:assert/strict';
import { related, tokenize } from '../scripts/similar.mjs';

const plugins = [
  { name: 'adr-helper', description: 'Write architecture decision records', tags: ['adr', 'architecture', 'documentation'], category: 'documentation', skills: [{ description: 'Record an architectural decision in MADR format' }] },
  { name: 'adr-index', description: 'Build an index of architecture decision records', tags: ['adr', 'documentation'], category: 'documentation' },
  { name: 'go-conventions', description: 'Go code style and table-driven tests', tags: ['go', 'golang', 'testing'], category: 'language-conventions' },
  { name: 'go-testing', description: 'Table-driven tests for Go', tags: ['go', 'testing', 'table-driven-tests'], category: 'testing' },
  { name: 'ts-conventions', description: 'TypeScript strict mode conventions', tags: ['typescript', 'strict-mode'], category: 'language-conventions' },
];

test('tokenize lowercases, splits kebab-case and drops stopwords', () => {
  assert.deepEqual(tokenize('Write the ADR-helper for Go'), ['write', 'adr', 'helper', 'go']);
});

test('related ranks the most similar plugins first, never itself', () => {
  const r = related(plugins, { top: 3 });
  assert.equal(r['adr-helper'][0], 'adr-index');
  assert.equal(r['go-conventions'][0], 'go-testing');
  for (const [name, list] of Object.entries(r)) {
    assert.ok(!list.includes(name));
    assert.ok(list.length <= 3);
  }
});

test('related omits plugins with zero similarity', () => {
  const r = related([
    { name: 'a', description: 'alpha apples', tags: [] },
    { name: 'b', description: 'beta bananas', tags: [] },
  ]);
  assert.deepEqual(r, { a: [], b: [] });
});

test('related is deterministic regardless of input order', () => {
  const a = related(plugins, { top: 2 });
  const b = related([...plugins].reverse(), { top: 2 });
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), [...Object.keys(a)].sort());
});

test('related handles empty and single-plugin input', () => {
  assert.deepEqual(related([]), {});
  assert.deepEqual(related([plugins[0]]), { 'adr-helper': [] });
});

test('related: pairs below minScore are dropped, so unrelated plugins are not shown as related', async () => {
  const { related, RELATED_MIN_SCORE } = await import('../scripts/similar.mjs');
  const mk = (name, description, tags) => ({ name, description, tags, category: '', skills: [] });
  const plugins = [
    mk('adr-helper', 'Write architecture decision records in MADR format, grounded in your code and its tests', ['adr', 'architecture', 'documentation']),
    mk('go-conventions', 'Go conventions: wrapped errors, table-driven tests, gofmt and go vet', ['go', 'conventions', 'testing']),
    mk('typescript-conventions', 'TypeScript conventions: strict mode, no any, Vitest tests', ['typescript', 'conventions', 'testing']),
  ];
  const out = related(plugins, { top: 3, minScore: RELATED_MIN_SCORE });
  assert.deepEqual(out['adr-helper'], []);
  assert.deepEqual(out['go-conventions'], ['typescript-conventions']);
  assert.deepEqual(out['typescript-conventions'], ['go-conventions']);
});

test('similarTo ranks existing plugins against a new name + description, filtered by RELATED_MIN_SCORE', async () => {
  const { similarTo, RELATED_MIN_SCORE } = await import('../scripts/similar.mjs');
  const r = similarTo({ name: 'adr-linter', description: 'Lint architecture decision records' }, plugins);
  assert.ok(r.length >= 1 && r.length <= 3);
  assert.ok(['adr-index', 'adr-helper'].includes(r[0].name));
  assert.ok(r.every((x) => typeof x.score === 'number' && x.score >= RELATED_MIN_SCORE));
  assert.ok(!r.some((x) => x.name === 'adr-linter'));
  assert.deepEqual(similarTo({ name: 'zz', description: 'quantum knitting patterns' }, plugins), []);
  assert.deepEqual(similarTo({ name: 'zz', description: 'anything' }, []), []);
});

test('docsFromRepo maps loadRepo plugins to similarity docs with skill descriptions', async () => {
  const { docsFromRepo } = await import('../scripts/similar.mjs');
  const repo = { plugins: [{
    dir: 'x', manifest: { description: 'd', keywords: ['k'] }, catalogue: { category: 'c' },
    skills: [{ name: 's', skillMd: '---\nname: s\ndescription: skill desc\n---\nbody' }],
  }, { dir: 'broken', manifest: null, catalogue: null, skills: [] }] };
  assert.deepEqual(docsFromRepo(repo), [
    { name: 'x', description: 'd', tags: ['k'], category: 'c', skills: [{ name: 's', description: 'skill desc' }] },
    { name: 'broken', description: '', tags: [], category: '', skills: [] },
  ]);
});
