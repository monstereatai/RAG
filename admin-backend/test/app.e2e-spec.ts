import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppController } from '../src/app.controller';

/**
 * E2E 测试套件：仅在 in-memory（无数据库）模式下执行。
 * 涵盖：健康检查 + 完整登录流程（注册 → 登录 → 使用 token 访问受保护路由）。
 */
describe('App E2E', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterAll(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ─── Health check（轻量，不启动完整 app） ───────────────────────────────
  describe('GET /health', () => {
    it('returns ok status via controller unit', () => {
      const controller = new AppController();
      expect(controller.health()).toMatchObject({
        status: 'ok',
        service: 'admin-backend',
      });
    });
  });

  // ─── Auth flow（完整 NestJS app，in-memory 用户） ──────────────────────
  describe('Auth flow', () => {
    let app: INestApplication;
    let httpServer: any;

    beforeAll(async () => {
      // 动态引入，避免 TypeORM 在测试环境触发真实连接
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

    const testUser = {
      username: 'e2e_user',
      password: 'Password@E2E1',
      email: 'e2e@test.com',
    };

    let accessToken: string;
    let refreshToken: string;

    it('POST /users — 注册新用户返回 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/users')
        .send(testUser)
        .expect(201);

      expect(res.body).toMatchObject({ username: testUser.username });
      expect(res.body).not.toHaveProperty('password');
    });

    it('POST /auth/login — 用注册账号登录返回 access_token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: testUser.username, password: testUser.password })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body.token_type).toBe('Bearer');
      accessToken = res.body.access_token;
      refreshToken = res.body.refresh_token;
    });

    it('GET /auth/refresh — refresh_token 可换新 access_token', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/refresh')
        .query({ refresh_token: refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body.token_type).toBe('Bearer');
    });

    it('POST /auth/login — 密码错误返回 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: testUser.username, password: 'WrongPassword@1' })
        .expect(401);
    });

    it('GET /users — 无 token 返回 401', async () => {
      await request(app.getHttpServer()).get('/users').expect(401);
    });

    it('GET /users — 带有效 token 返回 200 和用户列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /permissions — 无权限码时拒绝访问', async () => {
      await request(app.getHttpServer())
        .get('/permissions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });

    it('POST /users — 密码不足8位返回 400', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .send({ username: 'short', password: 'Ab1', email: 'x@x.com' })
        .expect(400);
    });
  });
});
