# Production Readiness Gates

This document lists the gates a real project should pass before production.

## Local Gates

```bash
npm run verify
npm run verify:ci
docker compose -f docker/docker-compose.yml config
```

`verify` is dependency-light and should pass without MySQL, Redis, or RabbitMQ.

`verify:ci` adds coverage threshold checks and is the CI default.

## Docker Integration Gates

Start infrastructure:

```bash
docker compose -f docker/docker-compose.yml up -d mysql-master redis rabbitmq prometheus grafana
```

Run integration smoke tests:

```bash
INTEGRATION_TESTS=true npm run verify:integration
```

Start the full stack:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Then verify:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/metrics
```

## CI Gates

The GitHub workflow currently enforces:

- dependency install with `npm ci`
- build
- lint
- coverage threshold
- E2E tests with open-handle detection
- migration rule checks
- Docker image build
- MySQL / Redis / RabbitMQ integration smoke tests

`npm run audit:high` runs as a visible but non-blocking report because the current dependency tree has high vulnerabilities that require a separate dependency-upgrade branch.

## Database Migration Rules

- Production must use `DB_SYNCHRONIZE=false`.
- `src/database/data-source.ts` must keep `synchronize: false`.
- Every schema change must be represented by a migration under `src/database/migrations/`.
- Production containers run compiled migrations through `npm run migration:run:prod`.
- Do not run migrations without an explicit production release plan and rollback plan.

## Current Known Risk

`npm audit --omit=dev --audit-level=high` currently reports high vulnerabilities through NestJS 10 transitive dependencies, Swagger/lodash, multer, nodemailer, and related packages. Fixing them likely requires a coordinated dependency upgrade and compatibility pass. Do not treat the admin backend as production-cleared until this audit is resolved or formally risk-accepted.
