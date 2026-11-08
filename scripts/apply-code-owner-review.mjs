#!/usr/bin/env node
// Turns on code-owner review once a second reviewer exists (Q28). Prepared, not enabled: GitHub
// never lets an author approve their own PR, so with a single code owner this would block every
// merge.
//
// Usage: node scripts/apply-code-owner-review.mjs --reviewer <@user|@org/team> [--dry-run]
//          [--repo <owner/name>] [--rulesets main,stable] [--codeowners <path>]
//
// --dry-run prints the new CODEOWNERS and, for each named ruleset, the PUT body (the live ruleset
// with required_approving_review_count 1 + require_code_owner_review + dismiss_stale_reviews_on_push
// + require_last_push_approval). It changes nothing (GETs only).
//
// Without --dry-run it runs in two steps, because the reviewer only counts as a code owner once
// CODEOWNERS on the base branch names them (flip the rulesets first and nobody can approve):
//   1. CODEOWNERS lacks the reviewer → write it, stop. Merge that PR.
//   2. Run again on an up-to-date main → CODEOWNERS already names them → PUT each ruleset with
//      `gh api -X PUT repos/<repo>/rulesets/<id> --input -`.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REVIEWER_RE = /^@?([A-Za-z0-9][A-Za-z0-9-]*)(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const READ_ONLY = ['id', 'node_id', 'source', 'source_type', 'created_at', 'updated_at', '_links', 'current_user_can_bypass'];

/** '@user' or '@org/team'; throws on anything else (it is passed to gh and written to CODEOWNERS). */
export function normaliseReviewer(s) {
  const m = REVIEWER_RE.exec(String(s ?? '').trim());
  if (!m) throw new Error(`invalid reviewer "${s}" — use @user or @org/team`);
  return `@${m[1]}${m[2] ?? ''}`;
}

/** Live ruleset (GET response) → PUT body with code-owner review on. Does not mutate the input. */
export function toRulesetUpdate(ruleset) {
  const body = structuredClone(ruleset);
  for (const k of READ_ONLY) delete body[k];
  const pr = body.rules?.find((r) => r.type === 'pull_request');
  if (!pr) throw new Error(`ruleset "${ruleset.name}" has no pull_request rule — add one first`);
  pr.parameters = {
    ...pr.parameters,
    required_approving_review_count: 1,
    require_code_owner_review: true,
    dismiss_stale_reviews_on_push: true,
    require_last_push_approval: true,
  };
  return body;
}

/** Appends the reviewer to every rule line (not comments/blank) that lacks it. Idempotent. */
export function addCodeOwner(text, reviewer) {
  return String(text).split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const hash = line.indexOf(' #');
    const rule = hash === -1 ? line.trimEnd() : line.slice(0, hash).trimEnd();
    const comment = hash === -1 ? '' : line.slice(hash);
    if (rule.split(/\s+/).slice(1).includes(reviewer)) return line;
    return `${rule} ${reviewer}${comment}`;
  }).join('\n');
}

function realGh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

const DEFAULT_CODEOWNERS = fileURLToPath(new URL('../.github/CODEOWNERS', import.meta.url));

/** @returns {number} exit code */
export function main(argv, {
  gh = realGh,
  log = console.log,
  warn = console.error,
  readFile = (p) => readFileSync(p, 'utf8'),
  writeFile = (p, t) => writeFileSync(p, t),
} = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: {
      reviewer: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      repo: { type: 'string', default: 'adam-m-holloway/agent-marketplace' },
      rulesets: { type: 'string', default: 'main,stable' },
      codeowners: { type: 'string', default: DEFAULT_CODEOWNERS },
    } }));
  } catch (e) {
    warn(e.message);
    return 2;
  }
  if (!values.reviewer) {
    warn('--reviewer is required (refusing to run): node scripts/apply-code-owner-review.mjs --reviewer <@user|@org/team> [--dry-run]');
    return 2;
  }
  let reviewer;
  try { reviewer = normaliseReviewer(values.reviewer); } catch (e) { warn(e.message); return 2; }
  const dry = values['dry-run'];
  const repo = values.repo;

  warn(`WARNING: ${reviewer} must have write access to ${repo} (a team must be visible and granted ` +
    'write), or GitHub ignores it as a code owner and every PR to a protected branch is blocked. ' +
    'Check: Settings → Collaborators and teams, or the CODEOWNERS errors view on GitHub.');

  try {
    const list = JSON.parse(gh(['api', `repos/${repo}/rulesets`]));
    const names = values.rulesets.split(',').map((s) => s.trim()).filter(Boolean);
    const hits = names.map((name) => {
      const hit = list.find((r) => r.name === name);
      if (!hit) throw new Error(`ruleset "${name}" not found in ${repo} (have: ${list.map((r) => r.name).join(', ') || 'none'})`);
      return hit;
    });
    const updates = hits.map(({ id, name }) =>
      ({ id, name, body: toRulesetUpdate(JSON.parse(gh(['api', `repos/${repo}/rulesets/${id}`]))) }));

    const current = readFile(values.codeowners);
    const owners = addCodeOwner(current, reviewer);

    if (dry) {
      log(`[dry-run] step 1 would write ${values.codeowners}:`);
      log(owners);
      for (const u of updates) {
        log(`[dry-run] step 2 would PUT repos/${repo}/rulesets/${u.id} (${u.name})`);
        log(JSON.stringify(u.body, null, 2));
      }
      return 0;
    }
    if (owners !== current) {
      writeFile(values.codeowners, owners);
      log(owners);
      log(`step 1 of 2: wrote ${values.codeowners} with ${reviewer}. Merge it in a PR, then re-run this ` +
        'command on an up-to-date main to update the rulesets.');
      return 0;
    }
    for (const u of updates) {
      log(`step 2 of 2: PUT repos/${repo}/rulesets/${u.id} (${u.name})`);
      gh(['api', '-X', 'PUT', `repos/${repo}/rulesets/${u.id}`, '--input', '-'], JSON.stringify(u.body));
    }
    log(`done: code-owner review is required on ${updates.map((u) => u.name).join(', ')}. ` +
      `Check: gh api repos/${repo}/rulesets/<id>`);
    return 0;
  } catch (e) {
    warn(`error: ${e.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
