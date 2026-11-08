// The one Conventional Commits rule, shared by .githooks/commit-msg and the CI `title` job.
export const TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'ci', 'build', 'perf', 'style', 'revert'];
const RE = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9._/-]*\\))?!?: (\\S.*)$`);
export const MAX_SUBJECT = 100;

/** @returns {string|null} null when the first line is a valid Conventional Commit, else the problem. */
export function checkMessage(firstLine) {
  const line = String(firstLine ?? '').replace(/\r?\n[\s\S]*$/, '');
  const m = RE.exec(line);
  if (!m) {
    return `"${line}" is not a Conventional Commit: expected "<type>(<scope>)?!?: <subject>" with type one of ${TYPES.join(', ')}`;
  }
  if (m[3].length > MAX_SUBJECT) return `subject is ${m[3].length} chars (max ${MAX_SUBJECT})`;
  return null;
}

/** Git-generated messages the hook lets through. */
export function isExempt(firstLine) {
  return /^(Merge |fixup! |squash! |amend! )/.test(String(firstLine ?? ''));
}
