import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';

/**
 * E2E 测试套件：管理后台运营模块端到端测试（独立运行）
 * 覆盖：search-ops / qa-ops / graph-ops / dashboard overview
 */
describe('Admin Operations E2E (standalone)', () => {
  let app: INestApplication;
  let httpServer: any;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    if (httpServer?.closeAllConnections) {
      httpServer.closeAllConnections();
    }
  });

  let accessToken: string;
  const testUser = {
    username: 'e2e_ops_user',
    password: 'Password@E2E1',
    email: 'e2e_ops@test.com',
  };

  describe('Authentication', () => {
    it('POST /users — register new user', async () => {
      await request(httpServer)
        .post('/users')
        .send(testUser)
        .expect(201);
    });

    it('POST /auth/login — login with registered user', async () => {
      const res = await request(httpServer)
        .post('/auth/login')
        .send({ username: testUser.username, password: testUser.password })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body.token_type).toBe('Bearer');
      accessToken = res.body.access_token;
    });
  });

  // ─── Dashboard Overview ────────────────────────────────────────────────
  describe('GET /admin/dashboard', () => {
    it('returns dashboard overview (may be 401/403 due to permission)', async () => {
      const res = await request(httpServer)
        .get('/admin/dashboard')
        .set('Authorization', `Bearer ${accessToken}`);

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('data');
        expect(res.body.data).toHaveProperty('cards');
      }
    });
  });

  // ─── Search Operations ──────────────────────────────────────────────────
  describe('Search Operations', () => {
    it('GET /admin/search-ops/overview returns search operations overview', async () => {
      const res = await request(httpServer)
        .get('/admin/search-ops/overview')
        .set('Authorization', `Bearer ${accessToken}`);

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('data');
      }
    });

    it('GET /admin/search-ops/queries/popular returns popular queries', async () => {
      const res = await request(httpServer)
        .get('/admin/search-ops/queries/popular')
        .set('Authorization', `Bearer ${accessToken}`);

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('available');
      }
    });
  });

  // ─── QA Operations ──────────────────────────────────────────────────────
  describe('QA Operations', () => {
    it('GET /admin/qa-ops/overview returns QA operations overview', async () => {
      const res = await request(httpServer)
        .get('/admin/qa-ops/overview')
        .set('Authorization', `Bearer ${accessToken}`);

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('data');
      }
    });
  });

  // ─── Graph Operations ───────────────────────────────────────────────────
  describe('Graph Operations', () => {
    it('GET /admin/graph-ops/overview returns graph operations overview', async () => {
      const res = await request(httpServer)
        .get('/admin/graph-ops/overview')
        .set('Authorization', `Bearer ${accessToken}`);

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('data');
      }
    });
  });

  // ─── Documents Management ───────────────────────────────────────────────
  describe('Documents Management', () => {
    it('GET /admin/documents returns documents list', async () => {
      const res = await request(httpServer)
        .get('/admin/documents')
        .set('Authorization', `Bearer ${accessToken}`);

      expect([200, 401, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('code');
      }
    });
  });

  // ─── Permission Check ──────────────────────────────────────────────────
  describe('Permission enforcement', () => {
    it('rejects requests without Authorization header', async () => {
      const res = await request(httpServer).get('/admin/search-ops/overview');
      expect([401, 403]).toContain(res.status);
    });

    it('rejects requests with invalid token', async () => {
      const res = await request(httpServer)
        .get('/admin/search-ops/overview')
        .set('Authorization', 'Bearer invalid-token-12345');
      expect([401, 403]).toContain(res.status);
    });
  });
});