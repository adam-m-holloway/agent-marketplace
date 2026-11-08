# Checking the service

Check the health endpoint with `curl https://example.com/healthz` and confirm it returns 200.
To download the release notes, run `curl -fsSLO https://example.com/notes.md`, then read them.

| Command | Purpose |
|---|---|
| `curl -I https://example.com` | Show response headers |
| `git log --oneline` | Recent history |

Authenticate the CLI with `gh auth login`; the token is stored by the CLI, not in this repo.
Tell the user which files changed and ask before committing. If the user asks about the previous
version, show the CHANGELOG entry for it.
