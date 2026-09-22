import {
  ConflictException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { RedisProvider } from '../../providers/redis/redis.provider';

/**
 * 认证用户落盘记录（workspace/auth-users.json）
 *
 * 决策说明：UserEntity（users 表）没有 email / emailVerified 列，且共享实体
 * 与迁移文件不在本模块可修改范围内；同时本项目要求「数据库不可用不阻断启动」。
 * 生产环境优先使用 Redis 共享 JSON 存储，开发环境才允许本地 JSON 文件；
 * 种子账号仅允许在非生产环境启用，生产环境必须通过一次性初始化流程创建管理员。
 * 后续接入 PG 时可平滑替换为 users 表 + email 迁移列，接口签名保持不变。
 */
export interface AuthUserRecord {
  id: string;
  /** 用户名（唯一，大小写不敏感） */
  username: string;
  /** 邮箱（唯一，大小写不敏感，用于激活与找回密码） */
  email: string;
  /** 真实姓名（可选） */
  realName?: string;
  /** scrypt 口令哈希（格式 scrypt:<saltHex>:<hashHex>） */
  passwordHash: string;
  role: 'admin' | 'user';
  /** 数据库租户迁移完成前可选；新部署应在签发 token 前补齐。 */
  tenantId?: string;
  /** 邮箱是否已激活（登录是否放行由 AUTH_REQUIRE_EMAIL_VERIFIED 控制） */
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthUserFile {
  version: 1;
  users: AuthUserRecord[];
}

/** 种子用户（仅开发／测试环境，生产环境绝不自动创建） */
const SEED_USERS: Array<{
  id: string;
  username: string;
  password: string;
  email: string;
  role: 'admin' | 'user';
}> = [
  {
    id: '1',
    username: 'admin',
    password: 'admin123',
    email: 'admin@rag.local',
    role: 'admin',
  },
  {
    id: '2',
    username: 'user',
    password: 'user1234',
    email: 'user@rag.local',
    role: 'user',
  },
];

/** scrypt 派生密钥长度（字节） */
const SCRYPT_KEYLEN = 64;

/**
 * 认证用户存储（Redis 共享存储，开发环境 JSON 文件降级）
 *
 * - Redis 可用时所有实例读写同一份数据；
 * - 非生产环境中种子用户在文件缺失或被删时自动补齐；
 * - 测试可通过 RAG_AUTH_USERS_STORE 把落盘文件指到临时路径（冒烟注入点）。
 */
@Injectable()
export class AuthUserStore {
  private readonly logger = new Logger(AuthUserStore.name);
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly configService?: ConfigService,
    @Optional() private readonly redisProvider?: RedisProvider,
  ) {
    const uploadDir =
      this.configService?.get<string>('workspace.uploadDir') ??
      resolve(process.cwd(), '../workspace/uploads');
    this.filePath =
      process.env.RAG_AUTH_USERS_STORE ??
      resolve(dirname(uploadDir), 'auth-users.json');
  }

  async findByUsername(username: string): Promise<AuthUserRecord | null> {
    const target = username.trim().toLowerCase();
    const { users } = await this.load();
    return users.find((user) => user.username.toLowerCase() === target) ?? null;
  }

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const target = email.trim().toLowerCase();
    const { users } = await this.load();
    return users.find((user) => user.email.toLowerCase() === target) ?? null;
  }

  async findById(id: string): Promise<AuthUserRecord | null> {
    const { users } = await this.load();
    return users.find((user) => user.id === id) ?? null;
  }

  /**
   * 创建注册用户（emailVerified=false）
   *
   * 用户名 / 邮箱重复时抛 409（AuthService 会先做前置查重给出更友好的拦截）。
   */
  async createUser(input: {
    username: string;
    email: string;
    passwordHash: string;
    realName?: string;
    role?: 'admin' | 'user';
  }): Promise<AuthUserRecord> {
    return this.withSharedWrite(async () => {
      const { users } = await this.load();
      const username = input.username.trim();
      const email = input.email.trim().toLowerCase();

      if (
        users.some(
          (user) => user.username.toLowerCase() === username.toLowerCase(),
        )
      ) {
        throw new ConflictException('username already exists');
      }
      if (users.some((user) => user.email.toLowerCase() === email)) {
        throw new ConflictException('email already registered');
      }

      const now = new Date().toISOString();
      const record: AuthUserRecord = {
        id: randomUUID(),
        username,
        email,
        realName: input.realName?.trim() || undefined,
        passwordHash: input.passwordHash,
        role: input.role ?? 'user',
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      };
      users.push(record);
      await this.save({ version: 1, users });
      return record;
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.withSharedWrite(async () => {
      const { users } = await this.load();
      const user = users.find((item) => item.id === id);
      if (!user) {
        throw new ConflictException('user not found');
      }
      user.passwordHash = passwordHash;
      user.updatedAt = new Date().toISOString();
      await this.save({ version: 1, users });
    });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.withSharedWrite(async () => {
      const { users } = await this.load();
      const user = users.find((item) => item.id === id);
      if (!user) {
        throw new ConflictException('user not found');
      }
      user.emailVerified = true;
      user.updatedAt = new Date().toISOString();
      await this.save({ version: 1, users });
    });
  }

  /** 加载用户列表并补齐种子用户；文件缺失 / 损坏时从空表开始 */
  private async load(): Promise<AuthUserFile> {
    if (this.redisProvider?.isEnabled()) {
      return this.loadShared();
    }
    if (!this.allowFileStore) {
      throw new ServiceUnavailableException(
        'shared auth user store is required but Redis is unavailable',
      );
    }
    let file: AuthUserFile = { version: 1, users: [] };
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as AuthUserFile;
      file = {
        version: 1,
        users: Array.isArray(parsed.users) ? parsed.users : [],
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        this.logger.warn(
          `auth users file unreadable, fallback to empty store: ${err.message}`,
        );
      }
    }

    // 种子用户只允许在非生产环境兜底；生产环境不因 Redis／文件为空而生成已知凭据。
    if (!this.allowSeedUsers) return file;
    let mutated = false;
    for (const seed of SEED_USERS) {
      const exists = file.users.some(
        (user) => user.username.toLowerCase() === seed.username,
      );
      if (exists) continue;
      const now = new Date().toISOString();
      file.users.push({
        id: seed.id,
        username: seed.username,
        email: seed.email,
        passwordHash: AuthUserStore.hashPassword(seed.password),
        role: seed.role,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      mutated = true;
    }
    if (mutated) {
      try {
        await this.save(file);
      } catch (error) {
        if (!this.allowFileStore) throw error;
        this.logger.warn(
          `failed to persist seed users: ${(error as Error).message}`,
        );
      }
    }
    return file;
  }

  /** 串行化原子写（临时文件 + rename），避免并发写坏文件 */
  private async save(file: AuthUserFile): Promise<void> {
    if (this.redisProvider?.isEnabled()) {
      const saved = await this.redisProvider.setRequired(
        'rag:auth:users:v1',
        JSON.stringify(file),
      );
      if (!saved) {
        throw new ServiceUnavailableException(
          'shared auth user store write failed',
        );
      }
      return;
    }
    if (!this.allowFileStore) {
      throw new ServiceUnavailableException(
        'shared auth user store is required but Redis is unavailable',
      );
    }
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(file, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  private get allowFileStore(): boolean {
    return (
      this.configService?.get<boolean>('auth.allowFileStore') !== false &&
      process.env.ALLOW_FILE_AUTH_STORE !== 'false'
    );
  }

  private get allowSeedUsers(): boolean {
    return (
      this.configService?.get<string>('nodeEnv') !== 'production' &&
      process.env.NODE_ENV !== 'production' &&
      process.env.ALLOW_AUTH_SEED_USERS !== 'false'
    );
  }

  /** Redis JSON 读改写需要跨实例互斥，否则两个注册／改密请求会互相覆盖。 */
  private async withSharedWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.redisProvider?.isEnabled()) return operation();
    const lockKey = 'rag:auth:users:lock:v1';
    const lockValue = randomUUID();
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await this.redisProvider.setIfAbsent(lockKey, lockValue, 10)) {
        try {
          return await operation();
        } finally {
          await this.redisProvider.releaseLock(lockKey, lockValue);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new ServiceUnavailableException(
      'shared auth user store is busy; retry the request',
    );
  }

  private async loadShared(): Promise<AuthUserFile> {
    const raw = await this.redisProvider?.get('rag:auth:users:v1');
    let file: AuthUserFile = { version: 1, users: [] };
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AuthUserFile;
        file = {
          version: 1,
          users: Array.isArray(parsed.users) ? parsed.users : [],
        };
      } catch {
        throw new ServiceUnavailableException(
          'shared auth user store contains invalid data',
        );
      }
    }
    if (!this.allowSeedUsers) return file;
    let mutated = false;
    for (const seed of SEED_USERS) {
      if (file.users.some((user) => user.username.toLowerCase() === seed.username)) {
        continue;
      }
      const now = new Date().toISOString();
      file.users.push({
        id: seed.id,
        username: seed.username,
        email: seed.email,
        passwordHash: AuthUserStore.hashPassword(seed.password),
        role: seed.role,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      mutated = true;
    }
    if (mutated) await this.save(file);
    return file;
  }

  /** 口令哈希：scrypt + 随机盐（无新增第三方依赖） */
  static hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
    return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  /** 口令校验（timingSafeEqual 防时序侧信道） */
  static verifyPassword(password: string, passwordHash: string): boolean {
    const [scheme, saltHex, hashHex] = passwordHash.split(':');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) {
      return false;
    }
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(
      password,
      Buffer.from(saltHex, 'hex'),
      SCRYPT_KEYLEN,
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}
