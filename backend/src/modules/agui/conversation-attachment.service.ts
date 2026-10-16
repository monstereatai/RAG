import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { VisionProvider } from '../../providers/vision/vision.provider';
import {
  detectDocumentKind,
  extractDocumentText,
  type SupportedDocumentKind,
} from '../document/document-parser.util';
import type { RetrievedChunk } from '../../rag/karpathy/karpathy-rag.service';

const ATTACHMENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_ATTACHMENTS_PER_THREAD = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 100_000;
const MAX_CONTEXT_CHARACTERS = 14_000;
const CHUNK_CHARACTERS = 1_800;

export interface ConversationAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string;
  truncated: boolean;
  createdAt: string;
}

export interface ConversationAttachmentContext {
  content: string;
  evidence: RetrievedChunk[];
}

@Injectable()
export class ConversationAttachmentService {
  constructor(
    private readonly redis: RedisProvider,
    private readonly vision: VisionProvider,
  ) {}

  async upload(
    file: Express.Multer.File,
    ownerUserId: string,
    threadId: string,
  ): Promise<ConversationAttachment> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择有效文件');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('单个附件不能超过 10 MB');
    }
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException('会话附件暂存服务不可用，请稍后重试');
    }

    const existingIds = await this.redis.smembersRequired(
      this.indexKey(ownerUserId, threadId),
    );
    if (existingIds.length >= MAX_ATTACHMENTS_PER_THREAD) {
      throw new BadRequestException('一个会话最多上传 5 个附件');
    }

    const kind = this.resolveAllowedKind(file.originalname);
    const content =
      kind === 'image'
        ? await this.extractImage(file)
        : await extractDocumentText(
            file.buffer,
            kind,
            this.vision,
            undefined,
            undefined,
            { preservePdfPages: true },
          );
    const normalized = content.trim();
    if (!normalized) {
      throw new BadRequestException(`${file.originalname} 没有解析出可用文字`);
    }

    const truncated = normalized.length > MAX_EXTRACTED_CHARACTERS;
    const text = truncated
      ? `${normalized.slice(0, MAX_EXTRACTED_CHARACTERS)}\n\n（附件内容较长，后续部分未加入本次会话）`
      : normalized;
    const attachment: ConversationAttachment = {
      id: randomUUID(),
      filename: this.safeFilename(file.originalname),
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      content: text,
      truncated,
      createdAt: new Date().toISOString(),
    };

    await this.redis.setRequiredOrThrow(
      this.attachmentKey(ownerUserId, threadId, attachment.id),
      JSON.stringify(attachment),
      ATTACHMENT_TTL_SECONDS,
    );
    await this.redis.saddRequired(
      this.indexKey(ownerUserId, threadId),
      attachment.id,
    );
    await this.redis.expireRequired(
      this.indexKey(ownerUserId, threadId),
      ATTACHMENT_TTL_SECONDS,
    );
    return attachment;
  }

  async list(ownerUserId: string, threadId: string) {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException('会话附件暂存服务不可用，请稍后重试');
    }
    const ids = await this.redis.smembersRequired(
      this.indexKey(ownerUserId, threadId),
    );
    const attachments = await Promise.all(
      ids.map((id) => this.read(ownerUserId, threadId, id)),
    );
    return attachments
      .filter((item): item is ConversationAttachment => Boolean(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async remove(ownerUserId: string, threadId: string, attachmentId: string) {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException('会话附件暂存服务不可用，请稍后重试');
    }
    const key = this.attachmentKey(ownerUserId, threadId, attachmentId);
    const attachment = await this.read(ownerUserId, threadId, attachmentId);
    if (!attachment) throw new NotFoundException('附件不存在或已过期');
    await this.redis.delRequired(key);
    await this.redis.sremRequired(this.indexKey(ownerUserId, threadId), attachmentId);
    return { deleted: true, attachmentId };
  }

  async removeAll(ownerUserId: string, threadId: string) {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException('会话附件暂存服务不可用，请稍后重试');
    }
    const indexKey = this.indexKey(ownerUserId, threadId);
    const ids = await this.redis.smembersRequired(indexKey);
    await Promise.all(
      ids.map((id) =>
        this.redis.delRequired(this.attachmentKey(ownerUserId, threadId, id)),
      ),
    );
    await this.redis.delRequired(indexKey);
    return { deleted: ids.length };
  }

  async retrieve(
    ownerUserId: string,
    threadId: string,
    requestedIds: string[] | undefined,
    query: string,
    previousQueries: string[] = [],
  ): Promise<ConversationAttachmentContext> {
    const all = await this.list(ownerUserId, threadId);
    const ids = requestedIds?.length ? [...new Set(requestedIds)] : all.map((item) => item.id);
    if (!ids.length) return { content: '', evidence: [] };

    const byId = new Map(all.map((item) => [item.id, item]));
    const attachments = ids.map((id) => byId.get(id));
    if (attachments.some((item) => !item)) {
      throw new BadRequestException('附件不存在、已过期，或不属于当前会话');
    }

    const resolvedAttachments = attachments.filter(
      (attachment): attachment is ConversationAttachment => Boolean(attachment),
    );
    const currentQueryLower = query.toLowerCase();
    const asksAboutImage = /(图片|图像|照片|截图|图中|图里|图片中|图片里|image|picture|photo)/i.test(
      query,
    );
    const currentNamedAttachments = resolvedAttachments.filter((attachment) =>
      currentQueryLower.includes(attachment.filename.toLowerCase()),
    );
    const recentNamedQuery = [...previousQueries]
      .reverse()
      .find((previous) =>
        resolvedAttachments.some((attachment) =>
          previous.toLowerCase().includes(attachment.filename.toLowerCase()),
        ),
      )
      ?.toLowerCase();
    const namedAttachments = currentNamedAttachments.length
      ? currentNamedAttachments
      : asksAboutImage
        ? resolvedAttachments.filter((attachment) =>
            attachment.mimeType.startsWith('image/'),
          )
        : recentNamedQuery
          ? resolvedAttachments.filter((attachment) =>
              recentNamedQuery.includes(attachment.filename.toLowerCase()),
            )
          : [];
    const searchableAttachments = namedAttachments.length
      ? namedAttachments
      : resolvedAttachments;
    const candidates = searchableAttachments.flatMap((attachment) =>
      this.splitIntoChunks(attachment),
    );
    const ranked = candidates
      .map((chunk) => ({
        ...chunk,
        score: this.score(
          query,
          `${chunk.attachment.filename}\n${chunk.content}`,
        ),
      }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    const matching = ranked.filter((item) => item.score > 0);
    const bestPerAttachment = new Map<string, (typeof ranked)[number]>();
    for (const item of matching) {
      if (!bestPerAttachment.has(item.attachment.id)) {
        bestPerAttachment.set(item.attachment.id, item);
      }
    }
    const primary = [...bestPerAttachment.values()];
    const primaryIds = new Set(primary.map((item) => item.attachment.id + item.order));
    const additional = ranked.filter(
      (item) => !primaryIds.has(item.attachment.id + item.order),
    );
    const selected = matching.length
      ? [...primary, ...additional].slice(0, 8)
      : ranked.slice(0, Math.min(4, ranked.length));

    let totalCharacters = 0;
    const evidence: RetrievedChunk[] = [];
    const sections: string[] = [];
    for (const chunk of selected) {
      if (totalCharacters >= MAX_CONTEXT_CHARACTERS) break;
      const content = chunk.content.slice(0, MAX_CONTEXT_CHARACTERS - totalCharacters);
      if (!content.trim()) continue;
      totalCharacters += content.length;
      const label = `来源：${chunk.attachment.filename}｜${chunk.location}`;
      sections.push(`${label}\n${content}`);
      evidence.push({
        id: `attachment:${chunk.attachment.id}:${chunk.order}`,
        content: `${label}\n${content}`,
        docId: chunk.attachment.filename,
        chunkIndex: chunk.order,
        totalScore: chunk.score,
        bm25Score: chunk.score,
        cosineScore: 0,
        retrievalSource: 'attachment',
        contextRole: 'hit',
        citationLabel: chunk.location,
      });
    }

    if (!sections.length) return { content: '', evidence: [] };
    return {
      content: sections.join('\n\n'),
      evidence,
    };
  }

  private async extractImage(file: Express.Multer.File): Promise<string> {
    const capabilities = this.vision.getCapabilities();
    if (!capabilities.ocr && !capabilities.imageUnderstanding) {
      throw new BadRequestException('当前视觉服务未启用图片识别，无法解析该图片');
    }
    const sections = [`# 图片附件：${this.safeFilename(file.originalname)}`];
    const errors: string[] = [];
    if (capabilities.ocr) {
      try {
        const result = await this.vision.ocr(file.buffer, file.mimetype);
        if (result.text?.trim()) sections.push(`## OCR 文字\n${result.text.trim()}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'OCR 失败');
      }
    }
    if (capabilities.imageUnderstanding) {
      try {
        const result = await this.vision.describeImage(file.buffer, file.mimetype);
        if (result.description?.trim()) {
          sections.push(`## 图片内容\n${result.description.trim()}`);
        }
        if (result.tags?.length) sections.push(`标签：${result.tags.join('、')}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '图片理解失败');
      }
    }
    if (sections.length === 1) {
      throw new BadRequestException(
        `图片解析失败${errors.length ? `：${errors.join('；')}` : '，没有识别到文字或图像内容'}`,
      );
    }
    return sections.join('\n\n');
  }

  private resolveAllowedKind(filename: string): SupportedDocumentKind {
    let kind: SupportedDocumentKind;
    try {
      kind = detectDocumentKind(filename);
    } catch {
      throw new BadRequestException('只支持图片、MD、DOCX 和 PDF 文件');
    }
    if (!['image', 'markdown', 'docx', 'pdf'].includes(kind)) {
      throw new BadRequestException('只支持图片、MD、DOCX 和 PDF 文件');
    }
    if (kind === 'image' && !/^image\/(jpeg|png|gif|webp|bmp)$/i.test('image/' + this.imageSubtype(filename))) {
      throw new BadRequestException('图片只支持 JPG、PNG、GIF、WEBP 和 BMP 格式');
    }
    return kind;
  }

  private imageSubtype(filename: string) {
    const extension = filename.split('.').pop()?.toLowerCase();
    return extension === 'jpg' ? 'jpeg' : extension ?? '';
  }

  private splitIntoChunks(attachment: ConversationAttachment) {
    const blocks = attachment.content.split(/(?=^#{1,4}\s)/m);
    const result: Array<{
      attachment: ConversationAttachment;
      content: string;
      location: string;
      order: number;
    }> = [];
    let order = 0;
    for (const block of blocks) {
      const heading = block.match(/^#{1,4}\s+(.+)$/m)?.[1]?.trim();
      const location = heading
        ? /第\s*\d+\s*页/.exec(heading)?.[0] ?? heading.slice(0, 80)
        : `片段 ${order + 1}`;
      const paragraphs = block.split(/\n\s*\n/);
      let chunk = '';
      for (const paragraph of paragraphs) {
        const next = chunk ? `${chunk}\n\n${paragraph}` : paragraph;
        if (next.length > CHUNK_CHARACTERS && chunk.trim()) {
          result.push({ attachment, content: chunk.trim(), location, order: ++order });
          chunk = paragraph;
        } else {
          chunk = next;
        }
      }
      if (chunk.trim()) {
        result.push({ attachment, content: chunk.trim(), location, order: ++order });
      }
    }
    return result;
  }

  private score(query: string, content: string) {
    const terms = this.tokens(query);
    if (!terms.length) return 0;
    const haystack = content.toLowerCase().replace(/[\s\p{P}]+/gu, '');
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += term.length > 1 ? 2 : 1;
    }
    return score / Math.sqrt(Math.max(1, content.length / 500));
  }

  private tokens(value: string) {
    const text = value.toLowerCase();
    const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    const compact = Array.from(text.replace(/[\s\p{P}]+/gu, ''));
    const bigrams = compact.flatMap((char, index) => {
      const next = compact[index + 1];
      return next && /^[\u3400-\u9fff\p{N}]{2}$/u.test(char + next)
        ? [`${char}${next}`]
        : [];
    });
    return [...new Set([...words, ...bigrams])];
  }

  private async read(ownerUserId: string, threadId: string, id: string) {
    const raw = await this.redis.getRequired(
      this.attachmentKey(ownerUserId, threadId, id),
    );
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ConversationAttachment;
    } catch {
      return null;
    }
  }

  private indexKey(ownerUserId: string, threadId: string) {
    return `qa:conversation-attachments:v1:${this.ownerKey(ownerUserId)}:${threadId}:index`;
  }

  private attachmentKey(ownerUserId: string, threadId: string, id: string) {
    return `qa:conversation-attachments:v1:${this.ownerKey(ownerUserId)}:${threadId}:${id}`;
  }

  private ownerKey(ownerUserId: string) {
    return createHash('sha256').update(ownerUserId).digest('hex').slice(0, 24);
  }

  private safeFilename(filename: string) {
    return filename.replace(/[\r\n/\\\[\]]/g, '_').slice(0, 180);
  }
}
