import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normaliseReviewer,
  toRulesetUpdate,
  addCodeOwner,
  main,
} from '../scripts/apply-code-owner-review.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/apply-code-owner-review.mjs', import.meta.url));

// Shape of a live GET repos/<repo>/rulesets/<id> response (trimmed _links).
const live = (name, include) => ({
  id: 26793907,
  name,
  target: 'branch',
  source_type: 'Repository',
  source: 'adam-m-holloway/agent-marketplace',
  enforcement: 'active',
  conditions: { ref_name: { exclude: [], include } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'pull_request', parameters: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      required_reviewers: [],
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      require_extra_approval_for_unattributed_changes: true,
      allowed_merge_methods: ['squash'] } },
    { type: 'required_status_checks', parameters: {
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: 'plugins' }, { context: 'security' }] } },
  ],
  node_id: 'RRS_x',
  created_at: '2026-11-08T10:03:42.147+00:00',
  updated_at: '2026-11-08T10:21:05.609+00:00',
  bypass_actors: [],
  current_user_can_bypass: 'never',
  _links: { self: { href: 'https://api.github.com/x' } },
});

test('normaliseReviewer: adds @, accepts users and org/team, rejects junk', () => {
  assert.equal(normaliseReviewer('octocat'), '@octocat');
  assert.equal(normaliseReviewer('@octocat'), '@octocat');
  assert.equal(normaliseReviewer('@my-org/admins'), '@my-org/admins');
  for (const bad of ['', '@', 'a b', '@x/y/z', 'x;rm -rf', '-x']) {
    assert.throws(() => normaliseReviewer(bad), /reviewer/, bad);
  }
});

test('toRulesetUpdate: turns on code-owner review and keeps everything else', () => {
  const before = live('main', ['~DEFAULT_BRANCH']);
  const body = toRulesetUpdate(before);
  const pr = body.rules.find((r) => r.type === 'pull_request').parameters;
  assert.equal(pr.require_code_owner_review, true);
  assert.equal(pr.dismiss_stale_reviews_on_push, true);
  assert.equal(pr.require_last_push_approval, true);
  assert.equal(pr.required_approving_review_count, 1);
  assert.deepEqual(pr.allowed_merge_methods, ['squash']);
  assert.equal(pr.require_extra_approval_for_unattributed_changes, true);
  // Other rules, conditions and bypass list untouched.
  assert.deepEqual(body.rules.filter((r) => r.type !== 'pull_request'),
    before.rules.filter((r) => r.type !== 'pull_request'));
  assert.deepEqual(body.conditions, before.conditions);
  assert.deepEqual(body.bypass_actors, []);
  // Read-only fields are not sent back.
  assert.deepEqual(Object.keys(body).sort(),
    ['bypass_actors', 'conditions', 'enforcement', 'name', 'rules', 'target']);
  // Input not mutated.
  assert.equal(before.rules[2].parameters.require_code_owner_review, false);
});

test('toRulesetUpdate: refuses a ruleset with no pull_request rule', () => {
  const rs = live('main', ['~DEFAULT_BRANCH']);
  rs.rules = rs.rules.filter((r) => r.type !== 'pull_request');
  assert.throws(() => toRulesetUpdate(rs), /pull_request/);
});

test('addCodeOwner: appends to every owner line, skips comments/blank, idempotent', () => {
  const text = [
    '# Owners',
    '#   node scripts/apply-code-owner-review.mjs --reviewer @x',
    '',
    '* @adam-m-holloway',
    '/plugins/*/status.json @adam-m-holloway',
    '/scripts/ @adam-m-holloway # tooling',
    '',
  ].join('\n');
  const out = addCodeOwner(text, '@my-org/admins');
  assert.equal(out, [
    '# Owners',
    '#   node scripts/apply-code-owner-review.mjs --reviewer @x',
    '',
    '* @adam-m-holloway @my-org/admins',
    '/plugins/*/status.json @adam-m-holloway @my-org/admins',
    '/scripts/ @adam-m-holloway @my-org/admins # tooling',
    '',
  ].join('\n'));
  assert.equal(addCodeOwner(out, '@my-org/admins'), out);
  // Owner match is exact, not a prefix (@adam-m-holloway must not satisfy @adam).
  assert.match(addCodeOwner('* @adam-m-holloway\n', '@adam'), /^\* @adam-m-holloway @adam$/m);
});

test('addCodeOwner: the real CODEOWNERS gains the reviewer on every rule line', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8');
  const rules = addCodeOwner(text, '@second').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.ok(rules.length >= 7);
  for (const l of rules) assert.match(l, /@adam-m-holloway @second$/);
  for (const p of ['/plugins/*/status.json', '/.github/', '/taxonomy.json', '/schema/', '/rules/', '/scripts/']) {
    assert.ok(rules.some((l) => l.startsWith(`${p} `)), p);
  }
});

test('CLI refuses to run without --reviewer', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--reviewer is required/);
});

test('main --dry-run: prints both rulesets + CODEOWNERS, warns about write access, writes nothing', () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(' '));
    if (args.includes('-X')) throw new Error('must not write in dry-run');
    if (args[1].endsWith('/rulesets')) return JSON.stringify([{ id: 1, name: 'main' }, { id: 2, name: 'stable' }]);
    if (args[1].endsWith('/1')) return JSON.stringify(live('main', ['~DEFAULT_BRANCH']));
    if (args[1].endsWith('/2')) return JSON.stringify(live('stable', ['refs/heads/stable']));
    throw new Error(`unexpected ${args}`);
  };
  const out = [];
  const err = [];
  let wrote = false;
  const code = main(['--reviewer', 'octocat', '--dry-run'], {
    gh,
    log: (s) => out.push(s),
    warn: (s) => err.push(s),
    readFile: () => '* @adam-m-holloway\n',
    writeFile: () => { wrote = true; },
  });
  assert.equal(code, 0);
  assert.equal(wrote, false);
  assert.ok(calls.every((c) => !c.includes('-X')));
  assert.match(err.join('\n'), /write access/);
  const text = out.join('\n');
  assert.match(text, /PUT repos\/adam-m-holloway\/agent-marketplace\/rulesets\/1 \(main\)/);
  assert.match(text, /PUT repos\/adam-m-holloway\/agent-marketplace\/rulesets\/2 \(stable\)/);
  assert.match(text, /"require_code_owner_review": true/);
  assert.match(text, /\* @adam-m-holloway @octocat/);
});

function fakeGh(puts) {
  return (args, input) => {
    if (args.includes('-X')) { puts.push({ path: args[3], body: JSON.parse(input) }); return '{}'; }
    if (args[1].endsWith('/rulesets')) return JSON.stringify([{ id: 1, name: 'main' }, { id: 2, name: 'stable' }, { id: 3, name: 'other' }]);
    return JSON.stringify(live(args[1].endsWith('/1') ? 'main' : 'stable', ['x']));
  };
}

test('main step 1: CODEOWNERS lacks the reviewer → writes it and does NOT touch rulesets', () => {
  const puts = [];
  let written = null;
  const code = main(['--reviewer', '@octocat'], {
    gh: fakeGh(puts), log: () => {}, warn: () => {},
    readFile: () => '* @adam-m-holloway\n',
    writeFile: (_p, t) => { written = t; },
  });
  assert.equal(code, 0);
  assert.equal(written, '* @adam-m-holloway @octocat\n');
  assert.deepEqual(puts, []);
});

test('main step 2: CODEOWNERS already names the reviewer → PUTs main and stable only', () => {
  const puts = [];
  const code = main(['--reviewer', '@octocat'], {
    gh: fakeGh(puts), log: () => {}, warn: () => {},
    readFile: () => '* @adam-m-holloway @octocat\n',
    writeFile: () => { throw new Error('must not rewrite CODEOWNERS'); },
  });
  assert.equal(code, 0);
  assert.deepEqual(puts.map((p) => p.path), [
    'repos/adam-m-holloway/agent-marketplace/rulesets/1',
    'repos/adam-m-holloway/agent-marketplace/rulesets/2',
  ]);
  assert.ok(puts.every((p) => p.body.rules.find((r) => r.type === 'pull_request').parameters.require_code_owner_review));
});

test('main: a missing ruleset name fails before any write', () => {
  const gh = (args) => {
    if (args.includes('-X')) throw new Error('must not write');
    return JSON.stringify([{ id: 1, name: 'main' }]);
  };
  const err = [];
  const code = main(['--reviewer', 'octocat'], {
    gh, log: () => {}, warn: (s) => err.push(s), readFile: () => '', writeFile: () => { throw new Error('no'); },
  });
  assert.equal(code, 1);
  assert.match(err.join('\n'), /ruleset "stable" not found/);
});
