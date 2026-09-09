import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';
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

  constructor(private readonly configService: ConfigService) {
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
      scopes: dto.scopes?.length ? dto.scopes : ['rag:*'],
      user,
      createdAt: now,
      expiresAt: dto.expiresAt,
    };

    const store = await this.load();
    store.tokens.push(record);
    await this.save(store);

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
      record.lastUsedAt = new Date().toISOString();
      await this.save(store).catch((error: unknown) => {
        this.logger.warn(
          `failed to update api token lastUsedAt: ${(error as Error).message}`,
        );
      });
      return record.user;
    }

    throw new UnauthorizedException('token invalid or expired');
  }

  private async load(): Promise<ApiTokenStore> {
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
