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
   diff (hooks, MCP servers, `allowed-tools`, `bin/`, URLs, pipe-to-shell), in its log and as
   a warning annotation per added capability.
   This creates `plugin.json`, `catalogue.json`, `status.json` (stage `sandbox`), a stub
   `SKILL.md` and stub evals. The stubs contain `TODO`s and **fail `npm run check` until
   filled in**.
3. **Author with `/skill-creator`** (enabled for this repo in `.claude/settings.json`). Ask it
   to draft `plugins/my-plugin/skills/my-skill/SKILL.md`. Then write the eval cases in
   `plugins/my-plugin/evals/my-skill/` in the native
   [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals) format (see
   [Eval cases](#eval-cases)); `claude plugin eval init`, run in `plugins/my-plugin`, can draft
   them for you.
4. **Check:**
   ```sh
   npm run sync     # regenerate both catalogues
   npm run check    # the plugin checks CI runs; CI also compares against main
                    # (version bump, stage gate), so run with --base for that locally
   npm run check -- --full   # + tests, claude plugin validate, and any installed scanners
   ```
   - No placeholders (`TODO`, `TBD`, `FIXME`, `<slot>`) in `SKILL.md` or the plugin `README.md`.
   - Every `references/`, `scripts/` or `assets/` path a `SKILL.md` mentions must exist in that skill's folder.
5. Open the PR with the plugin at `sandbox` (a new plugin must start there). Listing it is a
   separate, reviewed stage move — see [Move a plugin between stages](#move-a-plugin-between-stages).

For plugin-level structure (hooks, agents, commands — not used yet), use
`/plugin-dev:create-plugin`.

### Eval cases

Each skill needs, under `plugins/<plugin>/evals/<skill>/` (one directory per case):

- **≥3 behaviour cases**: `prompt.md` (frontmatter such as `max_turns`, `timeout_seconds`,
  `tags`, `allowed_tools`; the body is the prompt) and `graders/<name>.md`. Prefer deterministic
  graders (`regex`, `file_exists`, `tool_used`, `tool_order`); use an `llm` grader (the file body
  is the rubric: "PASS if … FAIL if …") only for what really needs judgement. Add a
  `skill-fired` grader (`type: tool_used`, `tool: Skill`, `input_match` naming the skill); in a
  with/without run it is reported, not scored.
- **≥8 should-trigger and ≥8 should-not-trigger cases** (include near misses): a prompt plus one
  `tool_used: Skill` grader; should-not-trigger adds `min: 0`, `max: 0` and `arm: both`. Give them
  `runs: 1` and a small `max_turns`.
- **Fixtures**: put the files in the case's `workspace/` and add a `case.yaml`
  (`schema_version: "1.1"`, `name`, `context.scaffold_script: scaffold.sh`) whose script copies
  `workspace/` into the run's empty working directory.

`npm run check` validates this: frontmatter parses with only known keys, every case has
graders of a known type with their required options and valid regexes, scaffold scripts exist,
case names and trigger prompts are unique, and the per-skill minimums hold. A case counts for a
skill when it sits under `evals/<skill>/`, is tagged with the skill, or its Skill grader names
it, so flat suites written by `claude plugin eval init` count too.

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

`npm run eval` runs a plugin's native suite (`plugins/<plugin>/evals/`) with
[`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals), with the plugin and
without it. It runs **locally only**, by hand, on your own Claude plan; CI never runs it.

```sh
npm run eval my-plugin -- --dry-run                 # print the claude command only
npm run eval my-plugin                              # run the suite, print per-case scores, record it
npm run eval my-plugin -- --runs 1 --max-cost-usd 3 # cheaper: one run per case per arm
npm run eval my-plugin -- --tag trigger             # only the trigger cases (not recorded)
npm run eval my-plugin -- --case 'is-it-done-*'     # one case (glob; not recorded)
```

- It runs `claude plugin eval plugins/<plugin>` with pinned `--model` and `--judge-model`
  (`claude-sonnet-5`), `--ablation with-without`, `--max-cost-usd 10`, `--scaffold`,
  `--trust-plugin`, `--no-publish` and `--allow-tools Bash Edit Write`. Override with `--model`,
  `--judge-model`, `--ablation none`, `--runs N`, `--max-cost-usd N`, `--keep-temp`.
- The JSON result and HTML report go to `eval-build/<plugin>/` (gitignored).
- A full run appends `{plugin, version, measured_at, method, overall_score, mean_delta,
  cases_passed, cases_total, cost_usd, claude_version, model, judge_model, ablation}` to
  `evals/results.json`. It never edits old runs, and skips partial runs (cost ceiling,
  interrupted) and runs narrowed with `--case` / `--tag`. The **Evals** score is the latest run's
  `overall_score` (as a percentage) at or before the plugin's version; its delta is
  `mean_delta`. Older records (skill-creator style) count passed expectations; each names its
  `method`.

**No network in the run.** Bash inside a `claude plugin eval` run is sandboxed with no network,
so a TypeScript case can't `npm install`. Its scaffold script runs outside the sandbox, as you,
before the agent starts, so it copies the fixture and runs `npm install --ignore-scripts`
there; `npx tsc` and `npx vitest run` then work offline. Go cases need only the standard library:
their scaffold sets `GOTOOLCHAIN=local GOPROXY=off` and caches under the workspace with
`go env -w`, only when HOME is the run's temporary home.

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
| sandbox → incubating | every skill has behaviour, should-trigger and should-not-trigger eval cases; `catalogue.json` `owner` set; no HIGH findings (patterns, hidden-content) |
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
