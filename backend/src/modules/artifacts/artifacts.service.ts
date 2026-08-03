import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ObjectStorageProvider } from '../../providers/object-storage/object-storage.provider';
import { ArtifactAccessLogEntity } from '../../providers/db/entities/artifact-access-log.entity';
import {
  ArtifactShareEntity,
  ArtifactShareVisibility,
} from '../../providers/db/entities/artifact-share.entity';
import { GeneratedArtifactEntity } from '../../providers/db/entities/generated-artifact.entity';
import { ArtifactGeneratorService } from './artifact-generator.service';
import { ArtifactQueueService } from './artifact-queue.service';
import { CreateArtifactDto, CreateArtifactShareDto } from './dto/artifact.dto';

export interface ArtifactAccessContext {
  actorUserId?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class ArtifactsService implements OnModuleInit {
  constructor(
    @InjectRepository(GeneratedArtifactEntity)
    private readonly artifacts: Repository<GeneratedArtifactEntity>,
    @InjectRepository(ArtifactShareEntity)
    private readonly shares: Repository<ArtifactShareEntity>,
    @InjectRepository(ArtifactAccessLogEntity)
    private readonly accessLogs: Repository<ArtifactAccessLogEntity>,
    private readonly dataSource: DataSource,
    private readonly storage: ObjectStorageProvider,
    private readonly generator: ArtifactGeneratorService,
    private readonly queue: ArtifactQueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor((artifactId) => this.process(artifactId));
  }

  async create(dto: CreateArtifactDto) {
    const id = randomUUID();
    const extension = this.extensionFor(dto.kind);
    const artifact = this.artifacts.create({
      id,
      ownerUserId: dto.ownerUserId,
      threadId: dto.threadId ?? null,
      title: dto.title.trim(),
      kind: dto.kind,
      status: 'queued',
      filename: `${this.safeFilename(dto.title)}.${extension}`,
      sourceText: dto.sourceText,
      prompt: dto.prompt ?? null,
      objectKey: null,
      storageUrl: null,
      contentType: null,
      size: 0,
      metadata: null,
      errorMessage: null,
    });
    await this.artifacts.save(artifact);
    await this.queue.enqueue(id);
    return this.toView(artifact);
  }

  async list(ownerUserId: string, threadId?: string) {
    const items = await this.artifacts.find({
      where: { ownerUserId, ...(threadId ? { threadId } : {}) },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return items.map((item) => this.toView(item));
  }

  async getOwned(id: string, ownerUserId: string) {
    const artifact = await this.artifacts.findOne({
      where: { id, ownerUserId },
    });
    if (!artifact) throw new NotFoundException('Artifact not found.');
    return artifact;
  }

  async getViewOwned(id: string, ownerUserId: string) {
    return this.toView(await this.getOwned(id, ownerUserId));
  }

  async getFileOwned(id: string, ownerUserId: string) {
    const artifact = await this.getOwned(id, ownerUserId);
    return this.readReadyFile(artifact);
  }

  async createShare(
    artifactId: string,
    ownerUserId: string,
    dto: CreateArtifactShareDto,
  ) {
    const artifact = await this.getOwned(artifactId, ownerUserId);
    if (artifact.status !== 'ready')
      throw new ForbiddenException('Only ready artifacts can be shared.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = dto.expiresInHours
      ? new Date(Date.now() + dto.expiresInHours * 60 * 60 * 1000)
      : null;
    const share = this.shares.create({
      id: randomUUID(),
      artifactId,
      createdBy: dto.createdBy,
      visibility: dto.visibility,
      tokenHash: this.hashToken(token),
      expiresAt,
      maxDownloads: dto.maxDownloads ?? null,
      downloadCount: 0,
      revokedAt: null,
    });
    await this.shares.save(share);
    return { ...this.toShareView(share), token };
  }

  async listShares(artifactId: string, ownerUserId: string) {
    await this.getOwned(artifactId, ownerUserId);
    const shares = await this.shares.find({
      where: { artifactId },
      order: { createdAt: 'DESC' },
    });
    return shares.map((share) => this.toShareView(share));
  }

  async revokeShare(artifactId: string, shareId: string, ownerUserId: string) {
    await this.getOwned(artifactId, ownerUserId);
    const share = await this.shares.findOne({
      where: { id: shareId, artifactId },
    });
    if (!share) throw new NotFoundException('Share not found.');
    share.revokedAt = new Date();
    await this.shares.save(share);
    return this.toShareView(share);
  }

  async getSharedMetadata(
    token: string,
    visibility: ArtifactShareVisibility,
    context: ArtifactAccessContext,
  ) {
    const { artifact, share } = await this.resolveShare(
      token,
      visibility,
      false,
    );
    await this.logAccess(artifact.id, share.id, 'preview', context);
    return { artifact: this.toView(artifact), share: this.toShareView(share) };
  }

  async getSharedFile(
    token: string,
    visibility: ArtifactShareVisibility,
    context: ArtifactAccessContext,
  ) {
    const resolved = await this.resolveShare(token, visibility, true);
    await this.logAccess(
      resolved.artifact.id,
      resolved.share.id,
      'download',
      context,
    );
    return this.readReadyFile(resolved.artifact);
  }

  async getSharedPreviewFile(
    token: string,
    visibility: ArtifactShareVisibility,
    context: ArtifactAccessContext,
  ) {
    const resolved = await this.resolveShare(token, visibility, false);
    await this.logAccess(
      resolved.artifact.id,
      resolved.share.id,
      'preview',
      context,
    );
    return this.readReadyFile(resolved.artifact);
  }

  private async process(artifactId: string): Promise<void> {
    const artifact = await this.artifacts.findOne({
      where: { id: artifactId },
    });
    if (!artifact) return;
    artifact.status = 'generating';
    artifact.errorMessage = null;
    await this.artifacts.save(artifact);
    try {
      const file = await this.generator.generate(artifact);
      artifact.filename = `${this.safeFilename(artifact.title)}.${file.extension}`;
      const stored = await this.storage.putObject({
        key: `artifacts/${artifact.ownerUserId}/${artifact.id}/${artifact.filename}`,
        body: file.body,
        contentType: file.contentType,
      });
      artifact.objectKey = stored.key;
      artifact.storageUrl = stored.url;
      artifact.contentType = file.contentType;
      artifact.size = file.body.length;
      artifact.metadata = file.metadata ? JSON.stringify(file.metadata) : null;
      artifact.status = 'ready';
      await this.artifacts.save(artifact);
    } catch (error) {
      artifact.status = 'failed';
      artifact.errorMessage =
        error instanceof Error ? error.message : 'Artifact generation failed.';
      await this.artifacts.save(artifact);
      throw error;
    }
  }

  private async resolveShare(
    token: string,
    visibility: ArtifactShareVisibility,
    countDownload: boolean,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const shareRepository = manager.getRepository(ArtifactShareEntity);
      const share = await shareRepository.findOne({
        where: { tokenHash: this.hashToken(token) },
        lock: countDownload ? { mode: 'pessimistic_write' } : undefined,
      });
      if (!share) throw new NotFoundException('Share not found.');
      if (share.visibility !== visibility)
        throw new ForbiddenException(
          'This share requires a different access channel.',
        );
      if (share.revokedAt)
        throw new GoneException('This share has been revoked.');
      if (share.expiresAt && share.expiresAt.getTime() <= Date.now())
        throw new GoneException('This share has expired.');
      if (
        share.maxDownloads !== null &&
        share.downloadCount >= share.maxDownloads
      ) {
        throw new GoneException('This share has reached its download limit.');
      }
      const artifact = await manager
        .getRepository(GeneratedArtifactEntity)
        .findOne({ where: { id: share.artifactId } });
      if (!artifact) throw new NotFoundException('Artifact not found.');
      if (countDownload) {
        share.downloadCount += 1;
        await shareRepository.save(share);
      }
      return { share, artifact };
    });
  }

  private async readReadyFile(artifact: GeneratedArtifactEntity) {
    if (
      artifact.status !== 'ready' ||
      !artifact.objectKey ||
      !artifact.contentType
    ) {
      throw new ForbiddenException('Artifact is not ready for download.');
    }
    return {
      artifact: this.toView(artifact),
      body: await this.storage.getObject(artifact.objectKey),
    };
  }

  private async logAccess(
    artifactId: string,
    shareId: string,
    action: 'preview' | 'download',
    context: ArtifactAccessContext,
  ) {
    await this.accessLogs.save(
      this.accessLogs.create({
        id: randomUUID(),
        artifactId,
        shareId,
        actorUserId: context.actorUserId ?? null,
        action,
        ip: context.ip?.slice(0, 128) ?? null,
        userAgent: context.userAgent?.slice(0, 512) ?? null,
      }),
    );
  }

  private toView(artifact: GeneratedArtifactEntity) {
    return {
      id: artifact.id,
      ownerUserId: artifact.ownerUserId,
      threadId: artifact.threadId,
      title: artifact.title,
      kind: artifact.kind,
      status: artifact.status,
      filename: artifact.filename,
      contentType: artifact.contentType,
      size: artifact.size,
      metadata: this.parseMetadata(artifact.metadata),
      errorMessage: artifact.errorMessage,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    };
  }

  private toShareView(share: ArtifactShareEntity) {
    return {
      id: share.id,
      artifactId: share.artifactId,
      visibility: share.visibility,
      expiresAt: share.expiresAt,
      maxDownloads: share.maxDownloads,
      downloadCount: share.downloadCount,
      revokedAt: share.revokedAt,
      createdAt: share.createdAt,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeFilename(value: string): string {
    const withoutControlCharacters = Array.from(value)
      .filter((character) => character.charCodeAt(0) >= 32)
      .join('');
    const safe = withoutControlCharacters
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80);
    return safe || 'artifact';
  }

  private parseMetadata(value: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private extensionFor(kind: GeneratedArtifactEntity['kind']): string {
    return {
      markdown: 'md',
      word: 'docx',
      excel: 'xlsx',
      architecture: 'svg',
      image: 'png',
    }[kind];
  }
}
