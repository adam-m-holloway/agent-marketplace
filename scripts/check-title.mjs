#!/usr/bin/env node
// Check a PR title against the same Conventional Commits rule as .githooks/commit-msg.
// Usage: node scripts/check-title.mjs "<title>"   (CI passes the title through env, never inline)
const title = process.argv[2] ?? process.env.PR_TITLE ?? '';
if (!title.trim()) {
  console.error('usage: check-title.mjs "<PR title>"');
  process.exit(2);
}

const { checkMessage } = await import('./lib/commit-msg.mjs');
const result = checkMessage(title);

// Accept the common result shapes: string[] of errors, string|null, boolean, or {ok, errors}.
let errors;
if (Array.isArray(result)) errors = result;
else if (typeof result === 'string') errors = result ? [result] : [];
else if (typeof result === 'boolean') errors = result ? [] : ['not a Conventional Commits title'];
else if (result && typeof result === 'object') errors = result.ok === false || result.errors?.length ? (result.errors ?? [result.message ?? 'invalid title']) : [];
else errors = [];

if (errors.length) {
  for (const e of errors) console.log(`::error title=PR title::${e}`);
  console.log('PR title must follow Conventional Commits, e.g. "feat(adr-helper): add supersede skill"');
  process.exit(1);
}
console.log('check-title: OK');
