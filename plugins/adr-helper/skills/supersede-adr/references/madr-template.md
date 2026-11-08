# MADR template for supersede-adr

This is the same template the `create-adr` skill uses. It follows MADR (Markdown Architectural
Decision Records, https://adr.github.io/madr/). Copy the structure below, replace every
bracketed part, and keep the headings and their order exactly as shown. Sections marked
optional may be left out when they would be empty; all others are required.

## Template

```markdown
# [Short title phrased as the decision, e.g. "Use PostgreSQL for order storage"]

- Status: [Proposed | Accepted]
- Date: [YYYY-MM-DD]
- Deciders: [names or team, as given by the user]

## Status

[Proposed | Accepted]. [One sentence if useful, e.g. "Agreed in the platform team review."]

## Context and Problem Statement

[Two to five sentences: the situation, the forces at play, and the question being
answered. Name real modules, files or dependencies from the repo where it helps. End with
the question, e.g. "Which database should store orders?"]

## Decision Drivers

[Optional. Bullet list of the criteria that mattered, e.g. "operational familiarity",
"cost at expected volume".]

## Considered Options

- [Option 1, the chosen one]
- [Option 2]
- [Option 3, if any]

## Decision Outcome

Chosen option: "[Option 1]", because [the main reason, in the user's terms].

## Consequences

- Good, because [a positive consequence].
- Bad, because [at least one cost, risk or follow-up the decision creates].

## Pros and Cons of the Options

[Optional, but recommended when there are three or more options.]

### [Option 1]

- Good, because [...]
- Bad, because [...]

### [Option 2]

- Good, because [...]
- Bad, because [...]

## More Information

[Optional. Links to related ADRs by file name (e.g. `0002-use-go.md`), issues, or
documents; when to revisit the decision.]
```

## Rules

- The required headings are, in this order: Status, Context and Problem Statement,
  Considered Options, Decision Outcome, Consequences.
- The metadata list under the title always has Status, Date and Deciders.
- The Status line in the metadata and the Status section must agree.
- The chosen option in Decision Outcome must appear, word for word, in Considered Options.
- Do not leave bracketed placeholders in the finished file. If you cannot fill a required
  part from what the user told you or the repo shows, ask the user instead.

## Superseding

- The new ADR's Status section starts with its status and the link to the ADR it
  replaces, for example: `Accepted. Supersedes [ADR-0002](0002-use-postgresql.md).`
- The old ADR's metadata line becomes `- Status: Superseded by [ADR-0003](0003-x.md)` and
  its Status section becomes `Superseded by [ADR-0003](0003-x.md).` Nothing else in the old
  ADR changes.
