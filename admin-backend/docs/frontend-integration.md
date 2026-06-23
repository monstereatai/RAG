# Frontend Integration Guide

## Base URLs

Local API:

```text
http://localhost:3001
```

Swagger:

```text
http://localhost:3001/api
```

Health:

```text
http://localhost:3001/health
```

## Authentication (Dual Token System)

Login endpoint:

```http
POST /auth/login
Content-Type: application/json
```

Response format now uses a standardized `{ code, message, data }` wrapper:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR...",
    "token_type": "Bearer"
  }
}
```

**Token Usage Strategy**:
1. Add `Authorization: Bearer <access_token>` to the HTTP headers of protected API calls.
2. When the `access_token` expires (e.g., after 30 minutes), the server will return `401 Unauthorized`.
3. The frontend should then catch the 401 error, and silently request a new access token using the `refresh_token`:

```http
GET /auth/refresh?refresh_token=<refresh_token>
```
4. Update the local storage with the new token pair and replay the original failed request.

## CORS

Allowed local origins are configured through:

```text
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

Add the frontend dev server origin before local integration.

## Common Endpoints

```text
GET /health
GET /users
POST /users
GET /orders
GET /payments
```

## Standard Response Format

All APIs (except `/health`) now respond with a unified JSON format. The frontend should configure an Axios interceptor to unwrap this structure:

```json
{
  "code": 200,     // HTTP status code
  "message": "...", // Success or Error message
  "data": { ... }  // The actual payload
}
```

## Frontend Smoke Test

The frontend can consider the backend ready when:

```bash
curl http://localhost:3001/health
```

returns detailed health check information including uptime and service modes:

```json
{
  "status": "ok",
  "service": "admin-backend",
  "timestamp": "2026-06-17T12:00:00.000Z",
  "uptime": 120.5,
  "mode": {
    "database": true,
    "redis": false
  }
}
```
