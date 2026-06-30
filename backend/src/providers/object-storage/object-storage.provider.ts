import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Client } from 'minio';

export interface StoredObject {
  key: string;
  url: string;
  provider: 'local' | 'minio';
}

@Injectable()
export class ObjectStorageProvider implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageProvider.name);
  private readonly provider: 'local' | 'minio';
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly localRoot: string;
  private client: Client | null = null;
  private minioReady = false;

  constructor(private readonly config: ConfigService) {
    this.provider =
      this.config.get<string>('objectStorage.provider') === 'minio'
        ? 'minio'
        : 'local';
    this.bucket =
      this.config.get<string>('objectStorage.bucket') ?? 'rag-documents';
    this.publicBaseUrl =
      this.config.get<string>('objectStorage.publicBaseUrl') ?? '';
    const uploadDir =
      this.config.get<string>('workspace.uploadDir') ??
      path.resolve(process.cwd(), '../workspace/uploads');
    this.localRoot = path.resolve(path.dirname(uploadDir), 'object-storage');
  }

  async onModuleInit(): Promise<void> {
    if (this.provider === 'local') {
      await fs.mkdir(this.localRoot, { recursive: true });
      this.logger.log(`Object storage using local path: ${this.localRoot}`);
      return;
    }

    this.client = new Client({
      endPoint:
        this.config.get<string>('objectStorage.endpoint') ?? '127.0.0.1',
      port: this.config.get<number>('objectStorage.port') ?? 9000,
      useSSL: this.config.get<boolean>('objectStorage.useSSL') ?? false,
      accessKey:
        this.config.get<string>('objectStorage.accessKey') ?? 'minioadmin',
      secretKey:
        this.config.get<string>('objectStorage.secretKey') ?? 'minioadmin',
    });

    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
      }
      this.minioReady = true;
      this.logger.log(`Object storage using MinIO bucket: ${this.bucket}`);
    } catch (err) {
      this.minioReady = false;
      this.logger.warn(
        `MinIO unavailable, falling back to local object storage: ${
          (err as Error).message
        }`,
      );
      await fs.mkdir(this.localRoot, { recursive: true });
    }
  }

  async putObject(params: {
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<StoredObject> {
    const safeKey = params.key.replace(/^\/+/, '');

    if (this.provider === 'minio' && this.client && this.minioReady) {
      await this.client.putObject(
        this.bucket,
        safeKey,
        params.body,
        params.body.length,
        params.contentType ? { 'Content-Type': params.contentType } : undefined,
      );
      return {
        key: safeKey,
        url: this.resolveMinioUrl(safeKey),
        provider: 'minio',
      };
    }

    const target = path.join(this.localRoot, safeKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, params.body);
    return {
      key: safeKey,
      url: `local://${safeKey}`,
      provider: 'local',
    };
  }

  private resolveMinioUrl(key: string): string {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, '')}/${this.bucket}/${key}`;
    }
    const endpoint =
      this.config.get<string>('objectStorage.endpoint') ?? '127.0.0.1';
    const port = this.config.get<number>('objectStorage.port') ?? 9000;
    const protocol = this.config.get<boolean>('objectStorage.useSSL')
      ? 'https'
      : 'http';
    return `${protocol}://${endpoint}:${port}/${this.bucket}/${key}`;
  }
}
