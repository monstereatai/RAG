# Backend Layers

This admin backend is intentionally split into two layers without deleting existing capabilities.

## Core Layer

The core layer is the baseline for a new backend service:

- runtime environment loading
- application logging
- scheduling foundation
- global validation
- Swagger setup
- health endpoint
- auth foundation
- user CRUD foundation
- quality gate scripts

Code entry point: `src/core/core.module.ts`.

## Enterprise Layer

The enterprise layer keeps advanced capabilities available as reusable examples:

- RBAC and permission management
- admin role management
- order and payment sample domains
- notifications, WebSocket gateway, and queue abstraction
- cache abstraction with in-memory default and Redis opt-in
- security middleware, audit logging, and Vault integration fallback
- metrics endpoint
- tracing abstraction and OpenTelemetry bootstrap
- circuit breaker and fault-tolerance examples
- file upload module
- scheduled task module
- independent admin backend modules for dashboard, document governance, RAG operations, audit log browsing, notifications, and system configuration status
- `rag-client` HTTP adapter for calling a separate RAG backend without importing RAG business code
- gRPC protocol/controller sample
- database replication and sharding support
- Docker, Kubernetes, Prometheus, and Grafana deployment assets

Code entry point: `src/enterprise/enterprise.module.ts`.

## Layer Rules

- New business features should start in the core layer only when almost every service needs them.
- Optional infrastructure integrations belong in the enterprise layer.
- Keep external dependencies opt-in through environment switches.
- Documentation must state whether a capability is default-runnable or integration-only.
- Do not create a shared package for admin/RAG contracts until interface duplication becomes a real maintenance cost.
- Admin backend modules may call RAG through HTTP only; they must not import RAG service internals.

## Verification Split

- Default local gate: `npm run verify`
- CI gate: `npm run verify:ci`
- Docker infrastructure gate: `INTEGRATION_TESTS=true npm run verify:integration`
- Compose static gate: `docker compose -f docker/docker-compose.yml config`
