# Repo setup

One-off GitHub configuration for `adam-m-holloway/agent-marketplace` and the two consumer
repos. Each step has the `gh` command and the click path. Run from a clone with `gh` logged in
(`repo` + `workflow` scopes).

## Labels

```sh
gh label create multi-plugin   --color 5319e7 --description "PR changes more than one plugin (reason in body)"
gh label create rollback       --color b60205 --description "Promotion of an older main commit to stable"
gh label create plugin-request --color 0e8a16 --description "Request for a plugin that doesn't exist"
gh label create bug            --color d73a4a --description "Something isn't working" --force
gh label create insights       --color 245bf3 --description "Opened by the nightly insights run" --force
gh label create behind         --color e7b56a --description "A consumer is behind the latest plugin version" --force
```

`insights.yml` also creates `insights` and `behind` itself (`gh label create --force`) before it
files issues, so these two are optional here.

Click path: **Issues → Labels → New label**.

## GitHub Pages

```sh
gh api -X POST repos/adam-m-holloway/agent-marketplace/pages -f build_type=workflow
```

Click path: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Once `stable` exists, allow it to deploy (by default the `github-pages` environment allows only
the default branch):

```sh
gh api -X POST repos/adam-m-holloway/agent-marketplace/environments/github-pages/deployment-branch-policies \
  -f name=stable -f type=branch
```

Click path: **Settings → Environments → github-pages → Deployment branches and tags → Add
deployment branch rule → `stable`**.

## Rulesets

Applied straight after each branch's first merge. Bypass is off for everyone.

### `main` (marketplace)

- PR required; required status checks `plugins`, `security`, `workflows`, `title`
  (from `pr-gate`), with **"require branches to be up to date"** — the gate compares the PR
  head with the base *tip*, so an out-of-date branch could be judged against versions it never
  saw;
- squash merge only;
- block force-push and deletion;
- target: default branch only — `data` and `stable` are therefore excluded.

```sh
gh api -X POST repos/adam-m-holloway/agent-marketplace/rulesets --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "plugins" }, { "context": "security" },
          { "context": "workflows" }, { "context": "title" } ] } }
  ],
  "bypass_actors": []
}
JSON
```

### `stable` (marketplace)

The same rules with `"name": "stable"` and
`"conditions": { "ref_name": { "include": ["refs/heads/stable"], "exclude": [] } }`.

### `main` (team-a, team-b)

The same shape with one required check, `ci`, against `adam-m-holloway/team-a` and
`adam-m-holloway/team-b`, but without "require branches to be up to date"
(`strict_required_status_checks_policy: false`).

Click path: **Settings → Rules → Rulesets → New branch ruleset**.

Check: `gh api repos/adam-m-holloway/<repo>/rulesets`.

## Code owners

`.github/CODEOWNERS` makes `@adam-m-holloway` the owner of everything, with explicit lines for
stage moves (`plugins/*/status.json`) and the rules PRs are judged by (`.github/` — workflows,
CODEOWNERS, dependabot — `taxonomy.json`, `schema/`, `rules/`, `scripts/`). Today it only
**requests** reviews: the rulesets have `require_code_owner_review: false`, because GitHub never
lets an author approve their own PR, so with a single owner every merge would be blocked.

### Turn on code-owner review

Prerequisite: a second reviewer — a user, or (once the repo is in an org) a team — with **write
access** to the repo. A code owner without write access is ignored, and every PR is then blocked.

Two steps, in this order: the reviewer only counts as a code owner once CODEOWNERS on the base
branch names them, so flip the rulesets first and nobody can approve.

1. Add the reviewer to every rule line in `.github/CODEOWNERS` (e.g.
   `* @adam-m-holloway @<user-or-org/team>`), open a PR and merge it.
2. Then switch on code-owner review in the `main` (id `26793907`) and `stable` (id `26794396`)
   rulesets. This GETs each live ruleset, drops the read-only fields, sets four fields on its
   `pull_request` rule and PUTs it back, keeping every other rule:

```sh
repo=adam-m-holloway/agent-marketplace
for id in 26793907 26794396; do
  gh api "repos/$repo/rulesets/$id" \
    | jq 'del(.id, .node_id, .source, .source_type, .created_at, .updated_at, ._links, .current_user_can_bypass)
          | (.rules[] | select(.type == "pull_request") | .parameters) += {
              required_approving_review_count: 1, require_code_owner_review: true,
              dismiss_stale_reviews_on_push: true, require_last_push_approval: true }' \
    | gh api -X PUT "repos/$repo/rulesets/$id" --input -
done
```

Preview first by dropping the last line of the pipe (the `| gh api -X PUT …`). Check afterwards:
`gh api repos/adam-m-holloway/agent-marketplace/rulesets/26793907 --jq '.rules[] | select(.type=="pull_request") | .parameters'`.

Click path: **Settings → Rules → Rulesets → main (then stable) → Require a pull request before
merging → Required approvals 1, Dismiss stale approvals, Require review from Code Owners, Require
approval of the most recent reviewable push**.

## Dependabot

`.github/dependabot.yml` checks the pinned actions weekly (with a 7-day cooldown so brand-new
releases settle first) and groups every bump into **one PR** (`groups: actions: patterns: ["*"]`),
titled `chore(deps): …` so it passes the `title` check. Dependabot keeps the full SHA pin and
updates the `# vX.Y.Z` comment. team-a (`gomod` + actions) and team-b (`npm` + actions) do the
same, one grouped PR per ecosystem.

Enable alerts and security updates once per repo:

```sh
for r in agent-marketplace team-a team-b; do
  gh api -X PUT repos/adam-m-holloway/$r/vulnerability-alerts
  gh api -X PUT repos/adam-m-holloway/$r/automated-security-fixes
done
```

Click path: **Settings → Code security → Dependabot alerts / Dependabot security updates →
Enable**. Version updates need no setting: the config file is enough.

## OpenSSF Scorecard

`.github/workflows/scorecard.yml` runs `ossf/scorecard-action` weekly, on every push to `main`
and on demand, and publishes the result to the public Scorecard API (`publish_results: true`,
which needs `id-token: write`). Nothing to configure. Results:

- viewer: <https://scorecard.dev/viewer/?uri=github.com/adam-m-holloway/agent-marketplace>;
- the raw JSON as the `scorecard` artifact on each run (30 days).

There is deliberately **no SARIF upload** (no code scanning / GHAS in scope), so findings don't
appear in the Security tab. `publish_results` restricts that workflow: no top-level `env` or
`defaults`, no workflow-level write permissions, and only allow-listed actions in the job — keep
it that way when editing it.

## Insights token

Slice 0 proved that the default `GITHUB_TOKEN` can read the consumer repos' Contents and
Commits APIs (public repos, 5,000 requests/hour). **No PAT is needed**, so there is no expiry to
track. On Enterprise, use a GitHub App instead (see `migration-to-enterprise.md`).

## Insights issues

`insights.yml` needs **`issues: write`** (set in the workflow's job permissions) to keep the
pinned "Plugin usage report" issue and the "Behind: …" issues. The workflow declares it, so
there is nothing to configure in **Settings → Actions**. If pinning is refused, the run logs a warning and carries on;
pin the issue by hand once. Issues are found by hidden marker comments
(`<!-- insights:daily-report -->`, `<!-- insights:behind:<plugin>:<consumer> -->`), so don't
edit those out.

## The `data` branch

An orphan branch written only by workflows: `insights.yml` (consumer snapshots, events,
`CATALOGUE.md`) and `release.yml` (score history). It isn't the default branch, so the `main`
ruleset doesn't apply to it.

## Scheduled workflows

GitHub disables cron workflows on public repos after 60 days without repo activity. Re-enable
`insights.yml` from the Actions tab if it stops.
