# Contributing

Every change goes through a **feature branch and a pull request**. Nobody commits to `main` or
`stable` directly; the rulesets enforce it.

## Add a plugin (skill-creator first)

1. **(Optional) Propose it** with the "New plugin proposal" issue form, so people can point
   out an existing plugin first. Search the [catalogue](https://adam-m-holloway.github.io/agent-marketplace/) too.
2. **Scaffold:**
   ```sh
   git switch -c feat/my-plugin
   npm run new-plugin my-plugin -- --skill my-skill --languages any \
     --description "One sentence on what it helps with"
   ```
   With `--description`, the scaffold first lists the **3 most similar existing plugins**
   (with scores) and asks `continue anyway? [y/N]` — extending one of those may be better than
   a new plugin. Add `--yes` to skip the question (scripts, CI). The description also fills
   `plugin.json`. The PR's `plugins` job prints the same similarity list, plus a capability
   diff (hooks, MCP servers, `allowed-tools`, `bin/`, URLs, pipe-to-shell), in its log.
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
   npm run check    # the plugin checks CI runs; CI also compares against main
                    # (version bump, stage gate), so run with --base for that locally
   npm run check -- --full   # + tests, claude plugin validate, and any installed scanners
   ```
5. Open the PR with the plugin at `sandbox` (a new plugin must start there). Listing it is a
   separate, reviewed stage move — see [Move a plugin between stages](#move-a-plugin-between-stages).

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

## Evaluate a plugin

`npm run eval` runs a plugin's skill-creator evals through `claude plugin eval` (Claude Code
2.1.224+), with the plugin and without it. It runs **locally only** and uses your own Claude
plan; CI never runs it.

```sh
npm run eval my-plugin -- --dry-run                     # build the suite and print the plan
npm run eval my-plugin -- --max-cost-usd 3              # run it and print per-case results
npm run eval my-plugin -- --max-cost-usd 3 --record     # … and append the run to evals/results.json
npm run eval my-plugin -- --case 'my-skill-2'           # one case (glob)
npm run eval my-plugin -- --keep-temp                   # keep run dirs; print each tsc/vitest/go call and its output
```

- Each `evals.json` case becomes a case dir: `prompt.md` (the prompt), one `llm` grader per
  expectation ("PASS if …"), a `file_exists` grader for each concrete path an expectation names,
  and the case's `files` copied into `workspace/`, which a scaffold script copies into the run's
  working directory.
- The suite is built in `eval-build/<plugin>/suite/` (gitignored). The CLI only accepts an
  `--eval-dir` inside the plugin, so the suite is copied to `plugins/<plugin>/eval-build/` for the
  run and removed afterwards. The raw JSON is `eval-build/<plugin>/result.json`.
- Each arm runs once (`--runs 1 --ablation with-without`), and the cases may use Bash, Edit and
  Write. `passed/total` counts expectations, the same unit as the skill-creator benchmarks.
- `--record` appends `{plugin, version, measured_at, with_skill, baseline, method, cost_usd}` to
  `evals/results.json`. It never edits old runs. It skips partial runs (for example when the cost
  ceiling is hit) and runs where any arm didn't finish (for example `timed out after 600s`): the
  graders still score whatever that arm left behind, so the total would be wrong. The **Evals**
  score uses the latest run at or before the plugin's version.

**Offline dependencies.** The `claude plugin eval` sandbox has no network, so a case can't
`npm install`. `npm run eval` installs dependencies **before** the run instead, outside the
sandbox:

- A case is a Node case when its skill ships a `package.json` fixture and the case mentions
  TypeScript, `tsc`, `vitest`, `npm` or `npx`. A Node case without a `package.json` gets a minimal
  one (`typescript` 7.0.2, `vitest` 5.1.0, `type: module`, `test`/`typecheck` scripts) and a
  `tsconfig.json`, in the build dir only. Nothing under `plugins/` changes.
- Each distinct set of dependencies (the `dependencies`/`devDependencies` fields, hashed) is
  installed once with `npm install --ignore-scripts` into `eval-build/.deps/<hash>/node_modules`
  (gitignored, reused across runs; delete it to refresh).
- The scaffold script runs as you, outside the sandbox, so it copies that `node_modules` into the
  run's workspace. `npx tsc` and `npx vitest run` then work offline. (`context.add_dirs` is no
  use here: it only exposes read-only dirs inside the case dir.)
- Go cases need only the standard library and the local toolchain. Their scaffold runs
  `go env -w GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off GOCACHE=… GOPATH=…` (writable dirs
  under the workspace's `.cache/`), which lands in the run's temporary HOME. It skips this if HOME
  is your real home, so your own Go config is never changed.

The no-network limitation is resolved for these cases (measured 2026-11-08, CLI 2.1.319). The
`--keep-temp` evidence shows `npx tsc --noEmit` reporting the real TS2322 error, `vitest run`
v5.1.0/v2.1.9 running the tests, and `go vet`/`go test` passing, all while the sandbox denied
`registry.npmjs.org`. typescript-conventions 1.0.1 went from 17/25 vs 13/25 (no dependencies) to
19/25 vs 17/25 (with them).

What remains: under `claude plugin eval` a single run sometimes stalls on API retries and hits
the 600 s case timeout. A run with a stalled arm isn't recorded, so rerun it. Hand-run
skill-creator benchmarks and `claude plugin eval` runs aren't directly comparable, so each record
in `evals/results.json` names its `method`.

## Rules

- **Conventional Commits** for commits and PR titles: `feat(my-plugin): add X`,
  `fix(sync): …`, `docs: …`, `chore(deps): …`. Enable the local hook once:
  `git config core.hooksPath .githooks`.
- **Squash-merge only, with an explicit message** (`gh pr merge N --squash --subject "<title> (#N)"
  --body "<summary>"`). Otherwise GitHub appends `Co-authored-by:` trailers for every other
  author email in the PR. Commit as your own GitHub identity (its noreply address is fine).
- **One plugin per PR.** Use the `multi-plugin` label only with a reason in the PR body.
- **Stages** (`status.json`): `sandbox` (not listed) → `incubating` (latest channel only) →
  `published` → `deprecated` → `retired` (not listed). Moves are gated; see below.
- **Taxonomy:** `catalogue.json` `category` and `plugin.json` `keywords` must come from
  `taxonomy.json`. Add new terms in their own PR.
- **Toolchain neutrality:** a skill with `languages` other than `any` must state its
  `compatibility` (the tools it needs) in its frontmatter.

## Move a plugin between stages

A stage move is its own PR that changes **only** `plugins/<name>/status.json` and the generated
catalogues (no version bump needed). Today @adam-m-holloway reviews and merges; code-owner
review (`.github/CODEOWNERS`) is switched on once a second reviewer exists.

```sh
git switch -c chore/stage-my-plugin
npm run stage my-plugin incubating      # stage + since = today, runs sync, prints the checklist
npm run stage my-plugin deprecated -- --reason "use other-plugin"
npm run stage my-plugin published -- --consumers consumers.json   # insights data, optional
```

`npm run stage` prints `PASS`/`FAIL` per gate, computed by the same functions as the
`stage-gate` PR check, and exits 1 while any gate fails. An illegal move writes nothing. You can
also ask for a move with the "Promote plugin stage" issue form.

| Move | Gate (`stage-gate`, each failure is an ERROR) |
|---|---|
| new plugin | starts at `sandbox` |
| any move | one step at a time (`sandbox → incubating → published → deprecated → retired`, plus `incubating → deprecated`); only `status.json` + generated catalogues change |
| sandbox → incubating | every skill has `evals.json` + `trigger-evals.json`; `catalogue.json` `owner` set; no HIGH findings (patterns, hidden-content) |
| incubating → published | ≥14 days at `incubating` **or** ≥2 active consumers (insights data via `--consumers`; without it, the 14 days); a CHANGELOG entry for the current version |
| → deprecated | `replacedBy` in `catalogue.json` (set in an earlier PR) or a `reason` in `status.json` |
| → retired | no active consumers in `latest/consumers.json`, or the `retire-anyway` label |

The stable channel lists only `published` and `deprecated` plugins; `incubating` is on latest only.

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
