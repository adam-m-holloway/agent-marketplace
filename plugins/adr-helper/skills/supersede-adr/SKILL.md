---
name: supersede-adr
description: Supersede an existing Architecture Decision Record (ADR) in docs/adr with a new one. Writes the new decision as the next numbered MADR file that says "Supersedes ADR-NNNN", marks the old ADR "Superseded by ADR-MMMM", and updates the docs/adr/README.md index. Use this whenever the user says a recorded decision has been replaced, reversed or overtaken, even if they never say "supersede" - for example "we're moving off Postgres, supersede ADR 0002", "replace the Go ADR with our new Rust decision", "ADR-0004 is no longer true, we switched to SQS", or "mark 0003 as superseded by a new decision to use gRPC". Not for recording a brand-new decision that replaces nothing (use create-adr), fixing typos or editing an ADR's content, reviewing an ADR, deprecating an API or a library, or editing READMEs and other docs.
---

# Supersede an ADR

Replace an accepted Architecture Decision Record (ADR) with a new one, and link the two
so a reader of either finds the other. ADRs are never rewritten when a decision changes:
the old record stays as history, and a new record explains what changed and why. An
invented rationale is worse than none, so ask rather than guess.

Exactly three files change, and no others:

1. the **new ADR** `docs/adr/MMMM-kebab-title.md` (created);
2. the **old ADR** `docs/adr/NNNN-....md` (its status only);
3. the **index** `docs/adr/README.md` (created if missing).

## Workflow

### 1. Find the ADR being superseded

Work out which ADR the user means: a number ("0002", "ADR-2"), a file name, or a topic
("the Postgres ADR"). Look in `docs/adr/` for files whose names start with four digits
and a hyphen.

- **It does not exist** (no such number, or no ADR matches the topic, or there is no
  `docs/adr/` at all): stop. Say which ADR you looked for, list the ADRs that do exist (or
  say there are none), and change nothing. Do not create the new ADR on its own; if the
  user wants a new decision that replaces nothing, that is the `create-adr` skill.
- **More than one could match**: list the candidates and ask which one.
- **It is already superseded** (its Status is `Superseded by ...`): tell the user which
  ADR superseded it and ask whether they mean that one instead.

Read the old ADR in full. Its title, context and options are the background for the new
one.

### 2. Gather the new decision

You need three things before writing anything:

1. **What changed**: why the old decision no longer holds (new requirements, a problem
   that appeared, a better option).
2. **The options** now being considered, at least two, including the chosen one. Keeping
   the old decision is usually one of them.
3. **The new decision**: which option was chosen and the main reason why.

Take these from the user's message and the conversation, and ground them in the repo the
same way `create-adr` does (dependency manifests, config, the affected packages). If any
of the three is missing or vague, **stop and ask** in one short message that lists exactly
what is missing, and change no files until you have the answers. Suggestions from the
code are fine as questions ("I see `pgx` in go.mod; is that what is being replaced?"),
never as fact.

Confirm the **deciders** if they are not obvious; never invent names. The new decision
must be **Accepted** to supersede anything. If it is only proposed, say the old ADR stays
in force until the new one is accepted, offer to record it as a Proposed ADR with
`create-adr`, and do not change the old ADR.

### 3. Write the new ADR

Follow `references/madr-template.md` exactly, and number and name the file the way
`create-adr` does:

- the new number is the **highest** existing number + 1, zero-padded to four digits (not
  the count of files);
- the slug is the decision title in lowercase kebab-case (`a-z`, `0-9`, `-`), about 60
  characters at most;
- never overwrite an existing file.

In the new ADR:

- the Status section reads `Accepted. Supersedes [ADR-NNNN](NNNN-old-slug.md).`, using
  the old ADR's real file name;
- the Context and Problem Statement says what the old decision was and what changed;
- Consequences includes at least one cost of switching (migration, retraining, rework).

### 4. Mark the old ADR as superseded

Change only these two places in the old ADR, and nothing else (keep its context,
options, outcome and date as they are; they are the history):

- the metadata line becomes `- Status: Superseded by [ADR-MMMM](MMMM-new-slug.md)`;
- the body of the `## Status` section becomes `Superseded by [ADR-MMMM](MMMM-new-slug.md).`

### 5. Update the index

Update `docs/adr/README.md` as described in `references/adr-index.md`: add the new ADR's
row and change the old ADR's Status to `Superseded by ADR-MMMM`. If the index does not
exist, create it with a row for every ADR in the folder.

### 6. Report back

Only report success after all three files are written. Give the three paths, a one-line
summary of the new decision, and any assumptions you made (such as the deciders) so the
user can correct them.

## Scope

This skill only supersedes one ADR with one new ADR. Creating a standalone ADR is
`create-adr`. Editing an ADR's wording, deprecating an ADR without a replacement, and
merging several ADRs into one are out of scope: say so, and offer what this skill or
`create-adr` can do instead.
