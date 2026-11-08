# Use PostgreSQL for service storage

- Status: Accepted
- Date: 2026-09-21
- Deciders: Platform team

## Status

Accepted.

## Context and Problem Statement

The order service needs durable, transactional storage, and orders reference inventory
rows that must stay consistent. Which database should backend services use?

## Considered Options

- PostgreSQL
- MongoDB
- DynamoDB

## Decision Outcome

Chosen option: "PostgreSQL", because orders need multi-row transactions and the team
already runs it in production.

## Consequences

- Good, because we get transactions and foreign keys without extra work.
- Bad, because we must run and upgrade a stateful database ourselves.
