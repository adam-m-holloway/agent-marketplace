---
name: create-adr
description: Write a new Architecture Decision Record (ADR) in MADR format as docs/adr/NNNN-kebab-title.md, numbered after the highest existing ADR, with the context grounded in the repo's code, and adds it to the docs/adr/README.md index. Use this whenever the user wants to record, document, capture or write up a technical or architectural decision, even if they never say "ADR" - for example "write down why we chose Postgres", "log the decision to move to gRPC", "add a decision record for dropping Redux", or "we agreed on X, document it". Also use it when the user asks for a new MADR file or the next ADR in docs/adr. Not for superseding or replacing an existing ADR (use supersede-adr), editing or deprecating an existing ADR, explaining what ADRs are, or writing general docs such as READMEs, design docs, RFCs, runbooks or changelogs.
---

# Create an ADR

Write one new Architecture Decision Record (ADR) in MADR format. An ADR is a short
document that a future reader uses to understand **why** the codebase looks the way it
does. Its value comes from being true: a confident, invented rationale is worse than no
ADR, because people will trust it. Everything below serves that goal.

## Workflow

### 1. Gather the decision

You need three things before writing anything:

1. **The problem**: what forced a decision (the context and the question being answered).
2. **The options**: at least two that were really considered, including the chosen one.
3. **The decision**: which option was chosen and the main reason why.

Take these from the user's message and the conversation first. Then look at the repo to
ground them (step 2).

If any of the three is missing or vague after that, **stop and ask** before writing the
file. Ask one short message that lists exactly what is missing, for example:

> To write this ADR I still need:
> - which alternatives you considered besides Kafka;
> - the main reason Kafka won.

Do not fill gaps with plausible-sounding guesses, and do not write a draft with
placeholders "to be filled in later". The user knows why the decision was made; you do
not. It is fine to suggest options you noticed in the code, but present them as
questions ("Did you also consider RabbitMQ? I see it in docker-compose.yml"), not as fact.
Code that shows what is running never tells you the problem it solves, so ask for the
problem whenever the user has not stated it, even if the repo hints at the decision.

Also ask for, or confirm, the **deciders** (the people or team who made the decision) if
they are not obvious. If the user does not know or does not care, use the git user name
or write "Not recorded"; never invent names.

### 2. Ground the context in the repo

Read the code that the decision touches, so the Context section names real things:
modules, files, dependencies, configuration, services. Useful places to look:

- dependency manifests (whatever the project uses: `go.mod`, `package.json`,
  `pyproject.toml`, `pom.xml`, `Cargo.toml` and so on);
- configuration and infrastructure files (compose files, CI workflows, deployment config);
- the packages or directories the decision affects;
- existing ADRs in `docs/adr/`, which may already describe related decisions. Link to
  them by file name when they are relevant.

Keep this proportionate: a few targeted reads, not a full audit. Mention concrete paths in
the ADR only when they help the reader. Facts from the code supplement the user's
reasons; they never replace them.

### 3. Work out the number and file name

1. Look in `docs/adr/` at the repo root. If it does not exist, create it.
2. Find every file whose name starts with four digits followed by a hyphen
   (for example `0007-use-postgres.md`). Take the **highest** number, not the count of
   files, because numbers can have gaps when ADRs are deleted or renamed.
3. The new number is highest + 1, zero-padded to four digits. If there are no ADRs yet,
   the first one is `0001`.
4. Build the slug from the decision title: lowercase, words joined with single hyphens,
   only `a-z`, `0-9` and `-`, no leading or trailing hyphen, at most about 60 characters.
   Phrase the title as the decision, for example "Use PostgreSQL for order storage" gives
   `0003-use-postgresql-for-order-storage.md`.
5. Never overwrite an existing file. If the computed name somehow exists, take the next
   number.

If the repo keeps ADRs somewhere else (for example `doc/adr/` or `docs/decisions/`) and
the user has not asked for `docs/adr/`, mention what you found and ask which to use.

### 4. Write the ADR

Read `references/madr-template.md` and follow it exactly. It defines the heading order,
the metadata lines (status, date, deciders) and what belongs in each section.

- **Status**: `Accepted` when the user says the decision is made; `Proposed` when it is
  still under discussion. Ask if unclear.
- **Date**: today's date in `YYYY-MM-DD` form, unless the user gives the date the decision
  was actually made.
- Write in plain, direct prose. Keep it short: most ADRs fit on one screen.
- **Pros and cons come only from the user or the repo.** List a pro or con for an option
  only when the user stated it or it is evident from the repo (for example, a Jenkinsfile
  shows the team already runs Jenkins). Never invent one to make the record look
  balanced. When an option has none, write "No pros/cons recorded." under it, or ask the
  user. A rejected option with no recorded reason is honest; a made-up reason is not.
- The Consequences section should include at least one downside, because real decisions
  have costs. Prefer a downside the user gave or the repo shows. If neither gives one, ask,
  or state the most direct cost of the chosen option (such as a new vendor or service to
  run) and list it in your report as an assumption for the user to confirm.

### 5. Update the index

Add the new ADR to `docs/adr/README.md`, following `references/adr-index.md`: one row per
ADR in a `| # | Title | Status | Date |` table, sorted by number. If the index does not
exist yet, create it with a row for every ADR in the folder, not only the new one. Change
no other existing file.

### 6. Report back

Only report success after both the ADR and the index are written. Give the path of the
new file and a one-line summary of the decision, and say whether the index was created or
updated. If you made any assumptions the user did not state (such as the status or the
deciders), list them so they can correct them.

## Scope

This skill creates new ADRs and keeps the index current. When a new decision replaces an
existing ADR, use the `supersede-adr` skill instead, so the two records are linked.
Amending the wording of an existing ADR, or deprecating one without a replacement, is out
of scope: say this skill does not cover it and offer to create a new ADR if that helps.
