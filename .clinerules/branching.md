# Workflow rules (persistent)

## Branching rule (user directive, applies to every session)

- Every new feature gets its own branch created off the latest `main`.
- Stay on that feature branch until the user explicitly commands:
  "merge to main and push".
- Never commit directly to `main`, never push, and never merge into
  `main` without an explicit user command.
