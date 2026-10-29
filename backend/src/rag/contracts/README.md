# RAG Contracts

This directory contains only stable TypeScript contracts shared across RAG and
chat boundaries.

- Keep data shapes and type aliases here; do not add Nest providers, services,
  persistence code, or business orchestration.
- Contracts must not import Chat, Agentic, or concrete RAG service
  implementations. Import types from neutral domain contracts instead.
- Preserve existing public import paths with type re-exports while consumers
  migrate incrementally.
- Keep request provenance, ACL scope, query plan, context budgets, and execution
  budgets explicit in request-scoped contracts. Do not turn session, memory,
  checkpoint, artifact, or trace state into one shared object.
