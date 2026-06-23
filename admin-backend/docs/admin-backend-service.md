# Admin Backend Service

This service is the independent `admin-backend` for an enterprise knowledge-base admin console.

## Architecture Decision

The admin backend is independent from the RAG backend.

```text
admin-frontend -> admin-backend -> rag-backend
frontend       -> rag-backend

rag-backend does not depend on admin-backend.
admin-backend does not import rag-backend internals.
```

The admin backend owns management concerns:

- users
- roles
- permissions
- dashboard
- document governance entry points
- RAG operations entry points
- audit logs
- notifications
- system configuration status

The RAG backend owns AI and knowledge-base concerns:

- document ingestion
- chunking
- embedding
- hybrid retrieval
- rerank
- answer generation
- Agent workflow
- GraphRAG runtime
- evaluation execution

## No Shared Package For Now

Do not create `packages/shared` at this stage.

Reason:

- Admin and RAG have different business models.
- Sharing DTOs too early makes admin fields constrain RAG service contracts.
- A small amount of duplicated call DTOs is cheaper than a wrong shared abstraction.

Current rule:

- `admin-backend` keeps `src/modules/rag-client/dto/*`.
- `rag-backend` keeps its own API DTO.
- The two services align through HTTP API contracts only.

## Implemented Modules

```text
src/modules/admin/
  admin.controller.ts
  admin-dashboard.service.ts

src/modules/rag-client/
  rag-client.module.ts
  rag-client.service.ts
  dto/rag-admin.dto.ts

src/modules/admin-documents/
  admin-documents.controller.ts

src/modules/rag-ops/
  rag-ops.controller.ts

src/modules/audit-logs/
  audit-logs.controller.ts
  audit-logs.service.ts

src/modules/admin-notifications/
  admin-notifications.controller.ts
  admin-notifications.service.ts

src/modules/system-config/
  system-config.controller.ts
  system-config.service.ts
```

## Routes

All routes are protected by the admin backend global `LoginGuard` unless explicitly marked public.

```text
GET  /admin/boundary
GET  /admin/dashboard

GET  /admin/documents
GET  /admin/documents/:docId
GET  /admin/documents/:docId/chunks

GET  /admin/rag/capabilities
GET  /admin/rag/vector-index
GET  /admin/rag/evaluations
GET  /admin/rag/conversations
POST /admin/rag/documents/:docId/reindex
POST /admin/rag/evaluations/run

GET  /admin/audit-logs
GET  /admin/notifications
GET  /admin/system-config
```

## RAG Service Contract

`RagClientService` calls the RAG backend through HTTP.

Default base URL:

```text
http://localhost:3000/api/v1
```

Optional runtime environment variables:

```text
RAG_SERVICE_BASE_URL=http://localhost:3000/api/v1
RAG_SERVICE_TIMEOUT_MS=2000
```

These values are read at runtime only. The admin backend does not require editing `.env` files.

## RAG Service Failure Behavior

If the RAG backend is unavailable, admin routes return a structured unavailable result instead of crashing the admin backend:

```json
{
  "available": false,
  "status": null,
  "data": null,
  "error": "fetch failed"
}
```

This keeps the admin service independently bootable.

## Layer Placement

The admin backend modules are imported by `src/enterprise/enterprise.module.ts`, not `src/core/core.module.ts`.

Reason:

- Core is for the minimum reusable service foundation.
- Admin console capabilities are enterprise application features.
- RAG operations are integration-oriented and should remain optional.
