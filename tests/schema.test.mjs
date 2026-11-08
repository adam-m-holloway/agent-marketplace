import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../scripts/lib/schema.mjs';

const paths = (errs) => errs.map((e) => e.path);

test('type checks incl. integer, array, null', () => {
  assert.deepEqual(validate({ type: 'string' }, 'x'), []);
  assert.equal(validate({ type: 'string' }, 1).length, 1);
  assert.deepEqual(validate({ type: 'integer' }, 3), []);
  assert.equal(validate({ type: 'integer' }, 3.5).length, 1);
  assert.deepEqual(validate({ type: 'number' }, 3.5), []);
  assert.equal(validate({ type: 'object' }, []).length, 1);
  assert.equal(validate({ type: 'array' }, {}).length, 1);
  assert.equal(validate({ type: 'object' }, null).length, 1);
  assert.deepEqual(validate({ type: ['string', 'null'] }, null), []);
});

test('required, properties, additionalProperties:false', () => {
  const s = {
    type: 'object',
    required: ['a', 'b'],
    additionalProperties: false,
    properties: { a: { type: 'string' }, b: { type: 'integer' } },
  };
  assert.deepEqual(validate(s, { a: 'x', b: 1 }), []);
  const errs = validate(s, { a: 2, c: true });
  assert.deepEqual(paths(errs).sort(), ['/a', '/b', '/c']);
  assert.ok(errs.find((e) => e.path === '/b').message.includes('required'));
  assert.ok(errs.find((e) => e.path === '/c').message.includes('not allowed'));
});

test('enum, const, pattern, minLength, maxLength', () => {
  assert.deepEqual(validate({ enum: ['a', 'b'] }, 'a'), []);
  assert.equal(validate({ enum: ['a', 'b'] }, 'c').length, 1);
  assert.equal(validate({ const: 'MIT' }, 'GPL').length, 1);
  assert.deepEqual(validate({ const: 'MIT' }, 'MIT'), []);
  assert.equal(validate({ type: 'string', pattern: '^\\d+$' }, '12a').length, 1);
  assert.equal(validate({ type: 'string', minLength: 2 }, 'a').length, 1);
  assert.equal(validate({ type: 'string', maxLength: 2 }, 'abc').length, 1);
  assert.deepEqual(validate({ type: 'string', minLength: 1, maxLength: 3 }, 'ab'), []);
});

test('items, minItems, maxItems with nested paths', () => {
  const s = { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } };
  assert.deepEqual(validate(s, ['a']), []);
  assert.equal(validate(s, []).length, 1);
  assert.equal(validate(s, ['a', 'b', 'c']).length, 1);
  assert.deepEqual(paths(validate(s, ['a', 3])), ['/1']);
  const nested = { type: 'object', properties: { l: s } };
  assert.deepEqual(paths(validate(nested, { l: ['a', 3] })), ['/l/1']);
});

test('real catalogue and status schemas', () => {
  const cat = JSON.parse(readFileSync(new URL('../schema/catalogue.schema.json', import.meta.url)));
  const st = JSON.parse(readFileSync(new URL('../schema/status.schema.json', import.meta.url)));
  assert.deepEqual(validate(cat, { category: 'documentation', owner: 'Adam', languages: ['any'] }), []);
  assert.ok(validate(cat, { category: 'documentation', owner: 'Adam', languages: [], extra: 1 }).length >= 2);
  assert.deepEqual(validate(st, { stage: 'published', since: '2026-11-08' }), []);
  assert.deepEqual(paths(validate(st, { stage: 'gone', since: '8 Nov' })).sort(), ['/since', '/stage']);
});
