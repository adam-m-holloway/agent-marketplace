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

An orphan branch written only by `insights.yml`. It isn't the default branch, so the `main`
ruleset doesn't apply to it.

## Scheduled workflows

GitHub disables cron workflows on public repos after 60 days without repo activity. Re-enable
`insights.yml` from the Actions tab if it stops.
