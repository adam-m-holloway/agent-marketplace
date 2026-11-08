# Use Go for backend services

- Status: Accepted
- Date: 2026-09-14
- Deciders: Platform team

## Status

Accepted.

## Context and Problem Statement

We are starting the order and inventory services and need one language for all backend
services so that on-call engineers can work across them. Which language should backend
services use?

## Considered Options

- Go
- Java
- TypeScript on Node.js

## Decision Outcome

Chosen option: "Go", because it builds to a single static binary, starts fast in
containers, and most of the team already writes it.

## Consequences

- Good, because deployment is one binary per service.
- Bad, because we lose the shared types we could have had with the TypeScript frontend.
