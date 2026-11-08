import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRepo, CHANNELS, stableJson } from '../scripts/lib/plugins.mjs';
import { buildCatalogues } from '../scripts/lib/catalogue.mjs';

const fixture = (n) => fileURLToPath(new URL(`./fixtures/sync/${n}`, import.meta.url));
const build = (n) => buildCatalogues(loadRepo(fixture(n)));
const entries = (r) => r.catalogues[0].json.plugins;
const reasonsFor = (r, name) => r.excluded.find((e) => e.name === name)?.reasons;

test('one catalogue per channel with name, owner, description, $schema', () => {
  const { catalogues } = build('good');
  assert.deepEqual(catalogues.map((c) => c.file), CHANNELS.map((c) => c.file));
  for (const [i, c] of catalogues.entries()) {
    assert.equal(c.channel, CHANNELS[i].id);
    assert.deepEqual(Object.keys(c.json), ['$schema', 'name', 'description', 'owner', 'plugins']);
    assert.equal(c.json.$schema, 'https://json.schemastore.org/claude-code-marketplace-manifest.json');
    assert.equal(c.json.name, CHANNELS[i].name);
    assert.equal(c.json.description, CHANNELS[i].description);
    assert.deepEqual(c.json.owner, { name: 'Adam Holloway' });
  }
  assert.deepEqual(catalogues[0].json.plugins, catalogues[1].json.plugins);
});

test('entry keys are exactly name/source/description/category/tags (no version)', () => {
  for (const e of entries(build('good'))) {
    assert.deepEqual(Object.keys(e), ['name', 'source', 'description', 'category', 'tags']);
    assert.equal(e.source, `./plugins/${e.name}`);
  }
  // extra field in catalogue.json never leaks into the entry; the plugin is excluded instead
  const r = build('mutate');
  assert.ok(!entries(r).some((e) => e.name === 'extra-field'));
  assert.ok(reasonsFor(r, 'extra-field').some((x) => /catalogue\.json.*version.*not allowed/.test(x)));
});

test('listing rules and stage prefixes', () => {
  const r = build('good');
  assert.deepEqual(entries(r).map((e) => e.name), ['beta-incubating', 'delta-deprecated', 'gamma-deprecated', 'zeta-published']);
  const by = Object.fromEntries(entries(r).map((e) => [e.name, e]));
  assert.equal(by['beta-incubating'].description, 'Incubating: The beta-incubating plugin');
  assert.equal(by['gamma-deprecated'].description, 'Deprecated: use zeta-published. The gamma-deprecated plugin');
  assert.equal(by['delta-deprecated'].description, 'Deprecated. The delta-deprecated plugin');
  assert.equal(by['zeta-published'].description, 'The zeta-published plugin');
  assert.equal(by['beta-incubating'].category, 'testing');
  assert.deepEqual(by['zeta-published'].tags, ['adr', 'madr']); // keywords -> tags
  assert.deepEqual(r.excluded, [
    { name: 'alpha-sandbox', reasons: ['stage is sandbox (not listed)'] },
    { name: 'omega-retired', reasons: ['stage is retired (not listed)'] },
  ]);
});

test('determinism: building twice gives byte-identical output', () => {
  const a = build('good').catalogues.map((c) => stableJson(c.json));
  const b = build('good').catalogues.map((c) => stableJson(c.json));
  assert.deepEqual(a, b);
});

test('MUTATE fixtures are each excluded with the right reason', () => {
  const r = build('mutate');
  assert.deepEqual(entries(r).map((e) => e.name), ['ok-plugin']);
  const expect = {
    'bad-category': /category "gardening" is not in taxonomy/,
    'off-keyword': /keyword "blockchain" is not in taxonomy tags/,
    'no-catalogue': /catalogue\.json: missing/,
    'no-status': /status\.json: missing/,
    'no-manifest': /plugin\.json: missing/,
    'listed-sandbox': /stage is sandbox/,
    'extra-field': /catalogue\.json/,
    'name-mismatch': /manifest name "other-name" does not match folder "name-mismatch"/,
    'a-very-long-plugin-name-that-goes-well-past-the-sixty-four-limitx': /name too long \(65 > 64\)/,
  };
  for (const [name, re] of Object.entries(expect)) {
    const reasons = reasonsFor(r, name);
    assert.ok(reasons, `${name} should be excluded`);
    assert.ok(reasons.some((x) => re.test(x)), `${name}: ${reasons.join('; ')}`);
  }
});

test('every reason is collected, not just the first', () => {
  assert.deepEqual(reasonsFor(build('mutate'), 'many-problems'), [
    'stage is sandbox (not listed)',
    'category "gardening" is not in taxonomy',
    'keyword "blockchain" is not in taxonomy tags',
    'keyword "nft" is not in taxonomy tags',
  ]);
});
