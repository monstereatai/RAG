# Admin Backend Rules

## Project Purpose

This repository is the independent NestJS admin backend for the enterprise knowledge base system. It keeps two layers:

- `core`: the default application foundation every service needs.
- `enterprise`: optional enterprise capabilities that remain enabled for admin operations and integration reuse.

Do not delete enterprise capabilities when simplifying the starter path. Instead, keep the layer boundary clear and preserve the admin/RAG service boundary.

## Structure Rules

- `src/core/` contains module aggregation for baseline application concerns.
- `src/enterprise/` contains module aggregation for advanced enterprise concerns.
- Existing feature modules stay in their current folders unless a dedicated migration plan is approved.
- `docs/backend-layers.md` is the source of truth for what belongs in each layer.
- `README.md` is for user-facing startup and usage. Detailed production notes belong under `docs/`.

## Development Rules

- Do not edit `.env`, `.env.development`, `.env.production`, secrets, tokens, or CI/CD configuration without explicit approval.
- Do not run database migrations or schema-changing commands without explicit approval.
- Keep default local startup dependency-light: MySQL, Redis, RabbitMQ, Vault, and OTLP must be opt-in.
- Do not mark a capability as production-ready unless it has a runnable verification path.
- For code changes, run `npm run verify` before delivery.

## Verification

Use these commands for normal admin backend validation:

```bash
npm run verify
npm start
curl http://localhost:3001/health
curl http://localhost:3001/metrics
```

Use external-service modes only when the required services and credentials are available.
