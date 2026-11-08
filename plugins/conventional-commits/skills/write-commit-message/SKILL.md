---
name: write-commit-message
description: Write a Conventional Commits message (type(scope) subject of 72 characters or fewer, a body wrapped at 72, and a BREAKING CHANGE footer plus a "!" when the change breaks an API) from the staged diff, plus a matching pull request title. It picks the scope from the changed paths and asks when the intent is not clear from the diff. Use this whenever the user wants a commit message or a PR title for their changes, even if they never say "Conventional Commits" - for example "write a commit message", "what should I commit this as", "commit msg for my staged changes", "give me a conventional commit for this", "suggest a PR title for this diff", or "is this a feat or a fix?". It only proposes the message; it commits only when the user explicitly asks. Not for writing PR descriptions or release notes, changelogs, ADRs, code review comments, summarising or explaining a diff, explaining the Conventional Commits spec, rewriting git history (rebase, squash, amend), or setting up commitlint or git hooks.
---

# Write a commit message

Write one Conventional Commits message for the changes the user is about to commit, and a
pull request title to match. The message is read by people scanning `git log`, by release
tooling that turns `feat`/`fix`/`!` into version bumps and changelogs, and by reviewers. A
wrong type or a missing breaking-change marker silently ships the wrong version number, so
accuracy matters more than polish.

## 1. Get the diff

Run `git diff --cached` (and `git diff --cached --stat` for the file list). That is the
change being committed; unstaged work is not part of it.

- If nothing is staged, say so and stop. Offer to show `git status`, but do not stage files
  yourself: what goes into a commit is the user's choice.
- If the user pasted a diff or pointed you at a file containing one, use that instead.
- For context, glance at `git log --oneline -20`. If the repo already uses Conventional
  Commits, reuse its scope names and style. Also check for a commitlint config
  (`commitlint.config.*`, `.commitlintrc*`, or a `commitlint` key in `package.json`) and
  follow its allowed types and scopes if one exists.

## 2. Work out the intent

Read the diff for what the change does to the behaviour of the code, not just which lines
moved. Then pick the type:

| Type | Use when the change… |
|---|---|
| `feat` | adds a capability a user or caller can see (new endpoint, option, command, export) |
| `fix` | corrects behaviour that was wrong (a bug, a crash, a wrong result) |
| `perf` | makes existing behaviour faster or lighter without changing what it does |
| `refactor` | restructures code with no behaviour change |
| `docs` | changes only documentation (README, docs/, comments that are not code) |
| `test` | adds or changes only tests |
| `build` | changes the build system or dependencies (package.json deps, Dockerfile, go.mod) |
| `ci` | changes CI configuration (.github/workflows, pipeline files) |
| `style` | formatting only (whitespace, semicolons), no code meaning changes |
| `chore` | maintenance that fits nothing above (tooling config, housekeeping) |
| `revert` | reverts an earlier commit |

If the diff mixes types, name it after the most significant change for the reader (a feature
with its tests is `feat`). If it really holds two unrelated changes, say so and suggest
splitting the commit, then give a message for each part.

**Ask when the intent is not clear.** The diff shows what changed, not why. When you cannot
tell from the diff, the user's message and the conversation which type applies or what
the change is for, ask one short question before writing the final message. Typical cases:
a changed constant or limit (fix, perf, or a product decision?), deleted code with no
explanation, or a behaviour change that could be either a bug fix or a new feature. For
example:

> This lowers `MAX_UPLOAD_MB` from 50 to 10. Is that fixing a problem (what was going
> wrong?), or a product change? It decides between `fix` and `feat`, and what the body says.

Do not fill the gap with a plausible reason. An invented "why" in a commit body is worse
than none, because future readers will believe it.

## 3. Pick the scope

The scope is the area of the codebase the change touches, taken from the changed paths:

- One package, module or top-level folder: use its name, e.g. `src/payments/refund.ts` and
  `src/payments/refund.test.ts` give `payments`; `packages/cli/...` gives `cli`.
- Prefer a scope the repo's history already uses for that area over a new spelling.
- Lowercase, short, no paths: `auth`, not `src/auth/` or `Authentication`.
- If the change spans several unrelated areas, or is repo-wide (formatting, a dependency
  bump), leave the scope out: `chore: bump typescript to 5.6`.

## 4. Spot breaking changes

A change is breaking when existing callers or users must change something to keep working:
a removed or renamed export, endpoint, flag or config key; a new required parameter; a
changed return type or error behaviour that callers rely on; a changed default with
visible effects; a dropped runtime version.

Check exported and public signatures in the diff, not only the intent the user described.
A `fix` can be breaking too.

When it is breaking, do both:

1. add `!` after the type or scope: `fix(dates)!: parse timestamps as UTC`;
2. add a footer that starts `BREAKING CHANGE: ` and tells callers what changed and what to
   do, e.g. `BREAKING CHANGE: parseDate() now requires a timeZone argument; pass "UTC" to
   keep the old results.`

## 5. Write the message

```
<type>(<scope>)<!>: <subject>

<body>

<footers>
```

- **Subject**: imperative mood ("add", not "added" or "adds"), lowercase first word, no
  full stop, and the whole first line (type, scope and subject together) at most 72
  characters. Say what the change does, not which files it touches.
- **Body** (optional for trivial changes): a blank line after the subject, then plain prose
  wrapped at 72 characters. Explain what changed and why, in terms the user or the diff
  supports. Leave out anything you would have to guess.
- **Footers**: `BREAKING CHANGE: ...` when breaking; issue references the user gave or the
  branch name shows (`Refs: #142`, `Closes #142`); any human co-authors the user names.
- **No AI attribution.** Never add `Co-Authored-By` lines for Claude or any AI, and no
  "Generated with" or similar lines, even if other tools add them by default or the user
  mentions that Claude helped. The commit records the people accountable for the change.
  Human co-authors the user names are fine.

Count the characters of the first line before you present it. If it is over 72, shorten
the subject rather than dropping the type or scope.

## 6. Give the PR title

Give a pull request title that matches the commit's first line (type, scope, `!` and
subject). Repos that squash-merge use the PR title as the final commit subject, so they
must agree.

## 7. Present it, and commit only if asked

Show the message in a fenced code block so it can be copied as-is, then the PR title on its
own line. Add a one-line note on any judgement call (why `fix` and not `feat`, why there is
no scope, why it is marked breaking).

Do not run `git commit` unless the user has explicitly asked you to commit. Proposing the
message is the default; committing changes their repo history. When they do ask, commit
with exactly the message you showed, for example with `git commit -F <file>` so line breaks
survive, and report the resulting `git log -1 --format=%H%n%B` output.

## Example

Staged diff: a new `exportOrdersCsv()` function in `src/orders/export.ts`, a route for it in
`src/orders/routes.ts`, and tests.

```
feat(orders): add CSV export for order history

Add exportOrdersCsv() and a GET /orders/export route that streams the
signed-in customer's orders as CSV, newest first.
```

PR title: `feat(orders): add CSV export for order history`
