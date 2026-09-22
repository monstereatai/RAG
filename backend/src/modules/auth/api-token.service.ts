import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
import { RedisProvider } from '../../providers/redis/redis.provider';
import type {
  ApiTokenRecordView,
  CreateApiTokenDto,
  CreateApiTokenResponse,
} from './dto/api-token.dto';

interface ApiTokenRecord {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  scopes: string[];
  user: JwtPayload;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

interface ApiTokenStore {
  version: 1;
  tokens: ApiTokenRecord[];
}

@Injectable()
export class ApiTokenService {
  private readonly logger = new Logger(ApiTokenService.name);
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly redisProvider?: RedisProvider,
  ) {
    const uploadDir =
      this.configService.get<string>('workspace.uploadDir') ??
      resolve(process.cwd(), '../workspace/uploads');
    this.filePath =
      process.env.RAG_API_TOKEN_STORE ??
      resolve(dirname(uploadDir), 'api-tokens.json');
  }

  async createToken(
    dto: CreateApiTokenDto,
    user: JwtPayload,
  ): Promise<CreateApiTokenResponse> {
    const token = `rag_pat_${randomBytes(32).toString('base64url')}`;
    const now = new Date().toISOString();
    const record: ApiTokenRecord = {
      id: randomBytes(12).toString('hex'),
      name: dto.name.trim(),
      prefix: token.slice(0, 16),
      hash: this.hashToken(token),
      // 新 Token 默认只允许问答；高风险能力必须由调用方显式申请 scope。
      scopes: dto.scopes?.length
        ? [...new Set(dto.scopes.map((scope) => scope.trim()).filter(Boolean))]
        : ['rag:chat'],
      user: {
        userId: user.userId,
        username: user.username,
        role: user.role,
        tenantId: user.tenantId,
      },
      createdAt: now,
      expiresAt: dto.expiresAt,
    };

    await this.withSharedWrite(async () => {
      const store = await this.load();
      store.tokens.push(record);
      await this.save(store);
    });

    return {
      ...this.toView(record),
      token,
      tokenType: 'Bearer',
    };
  }

  async listTokens(user: JwtPayload): Promise<ApiTokenRecordView[]> {
    const store = await this.load();
    return store.tokens
      .filter((token) => token.user.userId === user.userId)
      .map((token) => this.toView(token));
  }

  async revokeToken(id: string, user: JwtPayload): Promise<ApiTokenRecordView> {
    return this.withSharedWrite(async () => {
      const store = await this.load();
      const record = store.tokens.find(
        (token) => token.id === id && token.user.userId === user.userId,
      );
      if (!record) {
        throw new UnauthorizedException('api token not found');
      }
      record.revokedAt = record.revokedAt ?? new Date().toISOString();
      await this.save(store);
      return this.toView(record);
    });
  }

  async verifyApiToken(token: string): Promise<JwtPayload> {
    if (!token.startsWith('rag_pat_')) {
      throw new UnauthorizedException('token invalid or expired');
    }

    const store = await this.load();
    const hash = this.hashToken(token);
    for (const record of store.tokens) {
      if (!this.safeEqual(record.hash, hash)) {
        continue;
      }
      if (record.revokedAt) {
        throw new UnauthorizedException('api token revoked');
      }
      if (
        record.expiresAt &&
        new Date(record.expiresAt).getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('api token expired');
      }
      await this.withSharedWrite(async () => {
        const latest = await this.load();
        const current = latest.tokens.find((item) => item.id === record.id);
        if (!current) return;
        current.lastUsedAt = new Date().toISOString();
        await this.save(latest);
      }).catch((error: unknown) => {
        this.logger.warn(
          `failed to update api token lastUsedAt: ${(error as Error).message}`,
        );
      });
      return {
        ...record.user,
        authType: 'api-token',
        scopes: [...new Set(record.scopes)],
      };
    }

    throw new UnauthorizedException('token invalid or expired');
  }

  private async load(): Promise<ApiTokenStore> {
    if (this.redisProvider?.isEnabled()) {
      const raw = await this.redisProvider.get('rag:auth:api-tokens:v1');
      if (!raw) return { version: 1, tokens: [] };
      try {
        const parsed = JSON.parse(raw) as ApiTokenStore;
        return {
          version: 1,
          tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        };
      } catch {
        throw new ServiceUnavailableException(
          'shared API token store contains invalid data',
        );
      }
    }
    if (!this.allowFileStore) {
      throw new ServiceUnavailableException(
        'shared API token store is required but Redis is unavailable',
      );
    }
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ApiTokenStore;
      return {
        version: 1,
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { version: 1, tokens: [] };
      }
      throw error;
    }
  }

  private async save(store: ApiTokenStore): Promise<void> {
    if (this.redisProvider?.isEnabled()) {
      const saved = await this.redisProvider.setRequired(
        'rag:auth:api-tokens:v1',
        JSON.stringify(store),
      );
      if (!saved) {
        throw new ServiceUnavailableException('shared API token store write failed');
      }
      return;
    }
    if (!this.allowFileStore) {
      throw new ServiceUnavailableException(
        'shared API token store is required but Redis is unavailable',
      );
    }
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  private get allowFileStore(): boolean {
    return (
      this.configService.get<boolean>('auth.allowFileStore') !== false &&
      process.env.ALLOW_FILE_AUTH_STORE !== 'false'
    );
  }

  /** Redis JSON 读改写需要跨实例互斥，避免创建／撤销 Token 互相覆盖。 */
  private async withSharedWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.redisProvider?.isEnabled()) return operation();
    const lockKey = 'rag:auth:api-tokens:lock:v1';
    const lockValue = randomBytes(16).toString('hex');
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
      'shared API token store is busy; retry the request',
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private toView(record: ApiTokenRecord): ApiTokenRecordView {
    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      scopes: record.scopes,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
    };
  }
}
