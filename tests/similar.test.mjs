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
