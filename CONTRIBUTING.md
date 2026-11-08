# Contributing

Every change goes through a **feature branch and a pull request**. Nobody commits to `main` or
`stable` directly; the rulesets enforce it.

## Add a plugin (skill-creator first)

1. **(Optional) Propose it** with the "New plugin proposal" issue form, so people can point
   out an existing plugin first. Search the [catalogue](https://adam-m-holloway.github.io/agent-marketplace/) too.
2. **Scaffold:**
   ```sh
   git switch -c feat/my-plugin
   npm run new-plugin my-plugin -- --skill my-skill --languages any
   ```
   This creates `plugin.json`, `catalogue.json`, `status.json` (stage `sandbox`), a stub
   `SKILL.md` and stub evals. The stubs contain `TODO`s and **fail `npm run check` until
   filled in**.
3. **Author with `/skill-creator`** (enabled for this repo in `.claude/settings.json`). Ask it
   to draft `plugins/my-plugin/skills/my-skill/SKILL.md`, write
   `skills/my-skill/evals/evals.json`, run its benchmark, and build the trigger set. Its file
   formats are this repo's formats. **Save the trigger set** (it exports to `~/Downloads`) to
   `skills/my-skill/evals/trigger-evals.json`.
4. **Check:**
   ```sh
   npm run sync     # regenerate both catalogues
   npm run check    # same plugin verdict as CI
   npm run check -- --full   # + tests, claude plugin validate, and any installed scanners
   ```
5. Set `status.json` → `incubating` or `published` when it's ready to list, and open the PR.

For plugin-level structure (hooks, agents, commands — not used yet), use
`/plugin-dev:create-plugin`.

### Without skill-creator

You can write the files by hand. The same rules and formats apply, and CI checks them the same
way:

- `evals/evals.json`: `{ "skill_name", "evals": [{ "id", "prompt", "expected_output",
  "files"?, "expectations": [..] }] }` with **≥3 cases**.
- `evals/trigger-evals.json`: `[{ "query", "should_trigger" }]` with **≥8 true and ≥8 false**
  (include near-misses).

### The description rule

A skill's `description` says **what** it does, **when** to use it, the **trigger** phrases, and
what it is **not for**. It is ≤1024 characters. It's what Claude reads to decide whether to load
the skill, so vague descriptions don't trigger.

## Release a new version

```sh
npm run bump my-plugin minor    # patch | minor | major — updates plugin.json + CHANGELOG stub
```

Fill in the CHANGELOG entry. Changing any plugin file **without** a version bump fails CI.
Versions are never reused. When the PR merges to `main`, `release.yml` runs the tests, tags
`my-plugin--v<version>` and publishes a GitHub Release from the CHANGELOG section.

## Rules

- **Conventional Commits** for commits and PR titles: `feat(my-plugin): add X`,
  `fix(sync): …`, `docs: …`, `chore(deps): …`. Enable the local hook once:
  `git config core.hooksPath .githooks`.
- **Squash-merge only, with an explicit message** (`gh pr merge N --squash --subject "<title> (#N)"
  --body "<summary>"`). Otherwise GitHub appends `Co-authored-by:` trailers for every other
  author email in the PR. Commit as your own GitHub identity (its noreply address is fine).
- **One plugin per PR.** Use the `multi-plugin` label only with a reason in the PR body.
- **Stages** (`status.json`): `sandbox` (not listed) → `incubating` → `published` →
  `deprecated` (needs `replacedBy`) → `retired` (not listed).
- **Taxonomy:** `catalogue.json` `category` and `plugin.json` `keywords` must come from
  `taxonomy.json`. Add new terms in their own PR.
- **Toolchain neutrality:** a skill with `languages` other than `any` must state its
  `compatibility` (the tools it needs) in its frontmatter.

## Promotion to stable

`stable` only moves by a reviewed promotion PR:

```sh
npm run promote            # promotes origin/main; or: npm run promote <main-sha>
```

This cuts `promote/<date>-<sha>` from `stable`, sets its tree to `main@sha`, and opens a PR
titled `chore(stable): promote main@<sha>` listing each plugin's version change. The gate
checks that the tree equals that `main` commit. A promotion where any plugin's version goes
**backwards** needs the `rollback` label.

## A bad release (roll forward)

1. Revert the change by PR.
2. `npm run bump <plugin> patch` and merge — a new tag follows.
3. Latest consumers update (see `docs/consuming-plugins.md`).
4. Stable is unaffected unless that version was promoted. If it was, promote the fix, or
   promote an older `main` commit with the `rollback` label.

## Security

Report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md). What the gate scans for,
and what it can't catch, is in [`docs/security-scanning.md`](docs/security-scanning.md).
