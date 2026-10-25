import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisProvider } from '../../providers/redis/redis.provider';
import { EmbeddingProvider } from '../../providers/embedding/embedding.provider';
import { VisionProvider } from '../../providers/vision/vision.provider';
import {
  detectDocumentKind,
  extractDocumentText,
  type SupportedDocumentKind,
} from '../document/document-parser.util';
import type { RetrievedChunk } from '../../rag/karpathy/karpathy-rag.service';
import { MetricsService } from '../metrics/metrics.service';
import type { QueryContextMode } from '../../rag/planning/query-plan';
import type { PlannedRetrievalQuery } from '../../rag/planning/retrieval-policy.service';

const ATTACHMENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_ATTACHMENTS_PER_THREAD = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 100_000;
const MAX_CONTEXT_CHARACTERS = 14_000;
const CHUNK_CHARACTERS = 1_800;
const MAX_RETRIEVED_CHUNKS = 8;
const RRF_K = 60;
const MIN_ATTACHMENT_COSINE_SCORE = 0.35;
const ATTACHMENT_OVERVIEW_PHRASES = [
  '全文',
  '总结',
  '摘要',
  '概览',
  '概述',
  '主要内容',
  '核心内容',
  '讲了什么',
  '说了什么',
  'summary',
  'summarize',
  'overview',
  'whole document',
  'entire document',
  'what is this file about',
  'what is this document about',
] as const;

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

interface ConversationAttachmentChunk {
  content: string;
  location: string;
  order: number;
  vectorBase64?: string;
}

interface SearchableAttachmentChunk extends ConversationAttachmentChunk {
  vector?: number[];
}

interface StoredConversationAttachmentV2 extends ConversationAttachment {
  schemaVersion: 2;
  chunks: ConversationAttachmentChunk[];
}

type StoredConversationAttachment =
  | ConversationAttachment
  | StoredConversationAttachmentV2;

interface RankedAttachmentChunk extends SearchableAttachmentChunk {
  attachment: StoredConversationAttachment;
  bm25Score: number;
  cosineScore: number;
  totalScore: number;
  retrievalSource: 'bm25' | 'vector' | 'hybrid';
}

@Injectable()
export class ConversationAttachmentService {
  private readonly logger = new Logger(ConversationAttachmentService.name);

  constructor(
    private readonly redis: RedisProvider,
    private readonly vision: VisionProvider,
    private readonly embedding: EmbeddingProvider,
    private readonly metrics: MetricsService,
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
      throw new ServiceUnavailableException(
        '会话附件暂存服务不可用，请稍后重试',
      );
    }

    const existingIds = await this.attachmentIds(ownerUserId, threadId);
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

    const chunks: ConversationAttachmentChunk[] = this.splitIntoChunks(
      attachment,
    ).map(({ content, location, order }) => ({ content, location, order }));
    try {
      const vectors = await this.embedding.embedDocuments(
        chunks.map((chunk) => this.embeddingText(attachment, chunk)),
      );
      for (const [index, chunk] of chunks.entries()) {
        const vector = vectors[index];
        if (this.isValidVector(vector)) {
          chunk.vectorBase64 = this.encodeVector(vector);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Attachment embedding failed, storing lexical-only v2 data: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const stored: StoredConversationAttachmentV2 = {
      ...attachment,
      schemaVersion: 2,
      chunks,
    };

    await this.redis.setRequiredOrThrow(
      this.attachmentKey(ownerUserId, threadId, attachment.id),
      JSON.stringify(stored),
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
      throw new ServiceUnavailableException(
        '会话附件暂存服务不可用，请稍后重试',
      );
    }
    const ids = await this.attachmentIds(ownerUserId, threadId);
    const attachments = await Promise.all(
      ids.map((id) => this.readStored(ownerUserId, threadId, id)),
    );
    return attachments
      .filter((item): item is StoredConversationAttachment => Boolean(item))
      .map((item) => this.toPublicAttachment(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async remove(ownerUserId: string, threadId: string, attachmentId: string) {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException(
        '会话附件暂存服务不可用，请稍后重试',
      );
    }
    const key = this.attachmentKey(ownerUserId, threadId, attachmentId);
    const attachment = await this.readStored(
      ownerUserId,
      threadId,
      attachmentId,
    );
    if (!attachment) throw new NotFoundException('附件不存在或已过期');
    await Promise.all([
      this.redis.delRequired(key),
      this.redis.delRequired(
        this.legacyAttachmentKey(ownerUserId, threadId, attachmentId),
      ),
    ]);
    await Promise.all([
      this.redis.sremRequired(
        this.indexKey(ownerUserId, threadId),
        attachmentId,
      ),
      this.redis.sremRequired(
        this.legacyIndexKey(ownerUserId, threadId),
        attachmentId,
      ),
    ]);
    return { deleted: true, attachmentId };
  }

  async removeAll(ownerUserId: string, threadId: string) {
    if (!this.redis.isEnabled()) {
      throw new ServiceUnavailableException(
        '会话附件暂存服务不可用，请稍后重试',
      );
    }
    const indexKey = this.indexKey(ownerUserId, threadId);
    const legacyIndexKey = this.legacyIndexKey(ownerUserId, threadId);
    const ids = await this.attachmentIds(ownerUserId, threadId);
    await Promise.all(
      ids.flatMap((id) => [
        this.redis.delRequired(this.attachmentKey(ownerUserId, threadId, id)),
        this.redis.delRequired(
          this.legacyAttachmentKey(ownerUserId, threadId, id),
        ),
      ]),
    );
    await Promise.all([
      this.redis.delRequired(indexKey),
      this.redis.delRequired(legacyIndexKey),
    ]);
    return { deleted: ids.length };
  }

  async retrieve(
    ownerUserId: string,
    threadId: string,
    requestedIds: string[] | undefined,
    queries: PlannedRetrievalQuery[],
    previousQueries: string[] = [],
    contextMode: QueryContextMode = 'independent',
    includeRequestedContentOnEmpty = false,
  ): Promise<ConversationAttachmentContext> {
    const allIds = await this.attachmentIds(ownerUserId, threadId);
    const stored = await Promise.all(
      allIds.map((id) => this.readStored(ownerUserId, threadId, id)),
    );
    const all = stored.filter((item): item is StoredConversationAttachment =>
      Boolean(item),
    );
    const ids = requestedIds?.length
      ? [...new Set(requestedIds)]
      : all.map((item) => item.id);
    if (!ids.length) return { content: '', evidence: [] };

    const byId = new Map(all.map((item) => [item.id, item]));
    const attachments = ids.map((id) => byId.get(id));
    if (attachments.some((item) => !item)) {
      throw new BadRequestException('附件不存在、已过期，或不属于当前会话');
    }

    const resolvedAttachments = attachments.filter(
      (attachment): attachment is StoredConversationAttachment =>
        Boolean(attachment),
    );
    const normalizedQueries = this.normalizeQueries(queries);
    const originalQuery =
      normalizedQueries.find((item) => item.kind === 'original')?.text ?? '';
    if (!originalQuery) return { content: '', evidence: [] };
    const currentQueryLower = originalQuery.toLowerCase();
    const currentNamedAttachments = resolvedAttachments.filter((attachment) =>
      currentQueryLower.includes(attachment.filename.toLowerCase()),
    );
    const canInheritNamedAttachment = ['follow_up', 'mixed'].includes(
      contextMode,
    );
    const recentNamedQuery = canInheritNamedAttachment
      ? [...previousQueries]
          .reverse()
          .find((previousQuery) =>
            resolvedAttachments.some((attachment) =>
              previousQuery
                .toLowerCase()
                .includes(attachment.filename.toLowerCase()),
            ),
          )
          ?.toLowerCase()
      : undefined;
    const recentNamedAttachments = recentNamedQuery
      ? resolvedAttachments.filter((attachment) =>
          recentNamedQuery.includes(attachment.filename.toLowerCase()),
        )
      : [];
    const namedAttachments = currentNamedAttachments.length
      ? currentNamedAttachments
      : recentNamedAttachments;
    const searchableAttachments = namedAttachments.length
      ? namedAttachments
      : resolvedAttachments;
    const candidates = searchableAttachments.flatMap((attachment) =>
      this.storedChunks(attachment).map((chunk) => ({ attachment, ...chunk })),
    );
    const rankedByQuery = await Promise.all(
      normalizedQueries.map(async (plannedQuery) => ({
        plannedQuery,
        ranked: await this.rankCandidates(plannedQuery.text, candidates),
      })),
    );
    const fused = new Map<string, RankedAttachmentChunk>();
    for (const { plannedQuery, ranked } of rankedByQuery) {
      for (const item of ranked) {
        const key = `${item.attachment.id}:${item.order}`;
        const existing = fused.get(key);
        const weightedScore = item.totalScore * plannedQuery.weight;
        if (!existing) {
          fused.set(key, { ...item, totalScore: weightedScore });
          continue;
        }
        const bm25Score = Math.max(existing.bm25Score, item.bm25Score);
        const cosineScore = Math.max(existing.cosineScore, item.cosineScore);
        fused.set(key, {
          ...existing,
          bm25Score,
          cosineScore,
          totalScore: existing.totalScore + weightedScore,
          retrievalSource:
            bm25Score > 0 && cosineScore > 0
              ? 'hybrid'
              : cosineScore > 0
                ? 'vector'
                : 'bm25',
        });
      }
    }
    const ranked = [...fused.values()].sort(
      (left, right) =>
        right.totalScore - left.totalScore || left.order - right.order,
    );
    const matching = ranked.filter((item) => item.totalScore > 0);
    const bestPerAttachment = new Map<string, (typeof ranked)[number]>();
    for (const item of matching) {
      if (!bestPerAttachment.has(item.attachment.id)) {
        bestPerAttachment.set(item.attachment.id, item);
      }
    }
    const primary = [...bestPerAttachment.values()];
    const primaryIds = new Set(
      primary.map((item) => item.attachment.id + item.order),
    );
    const additional = ranked.filter(
      (item) =>
        item.totalScore > 0 && !primaryIds.has(item.attachment.id + item.order),
    );
    const allowZeroScoreFallback =
      currentNamedAttachments.length > 0 ||
      (recentNamedAttachments.length > 0 &&
        this.isAttachmentOverviewRequest(originalQuery)) ||
      (Boolean(requestedIds?.length) &&
        (includeRequestedContentOnEmpty ||
          this.isAttachmentOverviewRequest(originalQuery)));
    const selected = matching.length
      ? [...primary, ...additional].slice(0, MAX_RETRIEVED_CHUNKS)
      : allowZeroScoreFallback
        ? ranked.slice(0, Math.min(4, ranked.length))
        : [];

    let totalCharacters = 0;
    const evidence: RetrievedChunk[] = [];
    const sections: string[] = [];
    for (const chunk of selected) {
      if (totalCharacters >= MAX_CONTEXT_CHARACTERS) break;
      const content = chunk.content.slice(
        0,
        MAX_CONTEXT_CHARACTERS - totalCharacters,
      );
      if (!content.trim()) continue;
      totalCharacters += content.length;
      const label = `来源：${chunk.attachment.filename}｜${chunk.location}`;
      sections.push(`${label}\n${content}`);
      evidence.push({
        id: `attachment:${chunk.attachment.id}:${chunk.order}`,
        content: `${label}\n${content}`,
        docId: chunk.attachment.filename,
        chunkIndex: chunk.order,
        totalScore: chunk.totalScore,
        bm25Score: chunk.bm25Score,
        cosineScore: chunk.cosineScore,
        retrievalSource: 'attachment',
        contextRole: 'hit',
        citationLabel: chunk.location,
      });
    }

    for (const source of ['bm25', 'vector', 'hybrid'] as const) {
      this.metrics.observeAttachmentRetrievalHits(
        source,
        selected.filter((item) => item.retrievalSource === source).length,
      );
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
      throw new BadRequestException(
        '当前视觉服务未启用图片识别，无法解析该图片',
      );
    }
    const sections = [`# 图片附件：${this.safeFilename(file.originalname)}`];
    const errors: string[] = [];
    if (capabilities.ocr) {
      try {
        const result = await this.vision.ocr(file.buffer, file.mimetype);
        if (result.text?.trim())
          sections.push(`## OCR 文字\n${result.text.trim()}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'OCR 失败');
      }
    }
    if (capabilities.imageUnderstanding) {
      try {
        const result = await this.vision.describeImage(
          file.buffer,
          file.mimetype,
        );
        if (result.description?.trim()) {
          sections.push(`## 图片内容\n${result.description.trim()}`);
        }
        if (result.tags?.length)
          sections.push(`标签：${result.tags.join('、')}`);
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
    if (
      kind === 'image' &&
      !/^image\/(jpeg|png|gif|webp|bmp)$/i.test(
        'image/' + this.imageSubtype(filename),
      )
    ) {
      throw new BadRequestException(
        '图片只支持 JPG、PNG、GIF、WEBP 和 BMP 格式',
      );
    }
    return kind;
  }

  private imageSubtype(filename: string) {
    const extension = filename.split('.').pop()?.toLowerCase();
    return extension === 'jpg' ? 'jpeg' : (extension ?? '');
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
      const headingLocation = heading
        ? (/第\s*\d+\s*页/.exec(heading)?.[0] ?? heading.slice(0, 80))
        : undefined;
      const paragraphs = block.split(/\n\s*\n/);
      let chunk = '';
      const appendChunk = (content: string) => {
        if (!content.trim()) return;
        const chunkOrder = ++order;
        result.push({
          attachment,
          content: content.trim(),
          location: headingLocation ?? `片段 ${chunkOrder}`,
          order: chunkOrder,
        });
      };
      for (const paragraph of paragraphs) {
        if (paragraph.length > CHUNK_CHARACTERS) {
          appendChunk(chunk);
          chunk = '';
          for (const part of this.splitLongParagraph(paragraph)) {
            appendChunk(part);
          }
          continue;
        }
        const next = chunk ? `${chunk}\n\n${paragraph}` : paragraph;
        if (next.length > CHUNK_CHARACTERS && chunk.trim()) {
          appendChunk(chunk);
          chunk = paragraph;
        } else {
          chunk = next;
        }
      }
      appendChunk(chunk);
    }
    return result;
  }

  private splitLongParagraph(paragraph: string) {
    const characters = Array.from(paragraph);
    const parts: string[] = [];
    for (let start = 0; start < characters.length; ) {
      let end = Math.min(start + CHUNK_CHARACTERS, characters.length);
      if (end < characters.length) {
        for (
          let index = end - 1;
          index > start + CHUNK_CHARACTERS * 0.7;
          index--
        ) {
          if (
            /\s/u.test(characters[index]) ||
            /[。！？；，、.!?;:]/u.test(characters[index])
          ) {
            end = index + 1;
            break;
          }
        }
      }
      const part = characters.slice(start, end).join('').trim();
      if (part) parts.push(part);
      start = end;
    }
    return parts;
  }

  private async rankCandidates(
    query: string,
    candidates: Array<
      SearchableAttachmentChunk & { attachment: StoredConversationAttachment }
    >,
  ): Promise<RankedAttachmentChunk[]> {
    if (!candidates.length) return [];

    const bm25Scores = this.bm25Scores(query, candidates);
    let queryVector: number[] | undefined;
    if (candidates.some((item) => this.isValidVector(item.vector))) {
      try {
        const vector = await this.embedding.embedQuery(query);
        if (this.isValidVector(vector)) queryVector = vector;
      } catch (error) {
        this.logger.warn(
          `Attachment query embedding failed, using BM25 only: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const vectorScores = candidates.map((item) => {
      if (!queryVector || !this.isValidVector(item.vector)) return 0;
      const score = this.cosineSimilarity(queryVector, item.vector);
      return score >= MIN_ATTACHMENT_COSINE_SCORE ? score : 0;
    });
    const bm25Ranks = this.rankIndexes(bm25Scores);
    const vectorRanks = this.rankIndexes(vectorScores);

    return candidates
      .map((item, index) => {
        const bm25Score = bm25Scores[index] ?? 0;
        const cosineScore = vectorScores[index] ?? 0;
        const bm25Rank = bm25Ranks.get(index);
        const vectorRank = vectorRanks.get(index);
        const totalScore =
          (bm25Rank ? 1 / (RRF_K + bm25Rank) : 0) +
          (vectorRank ? 1 / (RRF_K + vectorRank) : 0);
        return {
          ...item,
          bm25Score,
          cosineScore,
          totalScore,
          retrievalSource:
            bm25Score > 0 && cosineScore > 0
              ? 'hybrid'
              : cosineScore > 0
                ? 'vector'
                : 'bm25',
        } satisfies RankedAttachmentChunk;
      })
      .sort((a, b) => b.totalScore - a.totalScore || a.order - b.order);
  }

  private normalizeQueries(queries: PlannedRetrievalQuery[]) {
    const byText = new Map<string, PlannedRetrievalQuery>();
    for (const query of queries) {
      const text = query.text.trim();
      if (!text) continue;
      const existing = byText.get(text);
      if (!existing || query.weight > existing.weight) {
        byText.set(text, { ...query, text });
      }
    }
    return [...byText.values()];
  }

  private bm25Scores(
    query: string,
    candidates: Array<
      SearchableAttachmentChunk & { attachment: StoredConversationAttachment }
    >,
  ) {
    const queryTerms = [...new Set(this.tokenOccurrences(query))];
    if (!queryTerms.length) return candidates.map(() => 0);

    const documents = candidates.map((item) =>
      this.tokenOccurrences(`${item.attachment.filename}\n${item.content}`),
    );
    const averageLength =
      documents.reduce((sum, terms) => sum + terms.length, 0) /
      Math.max(1, documents.length);
    const documentFrequency = new Map<string, number>();
    for (const terms of documents) {
      for (const term of new Set(terms)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }

    const k1 = 1.2;
    const b = 0.75;
    return documents.map((terms) => {
      const frequencies = new Map<string, number>();
      for (const term of terms) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      }
      return queryTerms.reduce((score, term) => {
        const frequency = frequencies.get(term) ?? 0;
        if (!frequency) return score;
        const df = documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
        const denominator =
          frequency +
          k1 * (1 - b + b * (terms.length / Math.max(1, averageLength)));
        return score + idf * ((frequency * (k1 + 1)) / denominator);
      }, 0);
    });
  }

  private rankIndexes(scores: number[]) {
    const ranked = scores
      .map((score, index) => ({ score, index }))
      .filter((item) => Number.isFinite(item.score) && item.score > 0)
      .sort((a, b) => b.score - a.score);
    return new Map(ranked.map((item, index) => [item.index, index + 1]));
  }

  private cosineSimilarity(left: number[], right: number[]) {
    if (left.length !== right.length || !left.length) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }
    if (!leftNorm || !rightNorm) return 0;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  private tokenOccurrences(value: string) {
    const text = value.toLowerCase();
    const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    const compact = Array.from(text.replace(/[\s\p{P}]+/gu, ''));
    const bigrams = compact.flatMap((char, index) => {
      const next = compact[index + 1];
      return next && /^[\u3400-\u9fff\p{N}]{2}$/u.test(char + next)
        ? [`${char}${next}`]
        : [];
    });
    return [...words, ...bigrams];
  }

  private isAttachmentOverviewRequest(query: string) {
    const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
    return ATTACHMENT_OVERVIEW_PHRASES.some((phrase) =>
      normalized.includes(phrase),
    );
  }

  private async readStored(ownerUserId: string, threadId: string, id: string) {
    const raw =
      (await this.redis.getRequired(
        this.attachmentKey(ownerUserId, threadId, id),
      )) ??
      (await this.redis.getRequired(
        this.legacyAttachmentKey(ownerUserId, threadId, id),
      ));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredConversationAttachment;
    } catch {
      return null;
    }
  }

  private storedChunks(attachment: StoredConversationAttachment) {
    if (
      'schemaVersion' in attachment &&
      attachment.schemaVersion === 2 &&
      Array.isArray(attachment.chunks)
    ) {
      return attachment.chunks.map((chunk) => ({
        ...chunk,
        vector: this.decodeVector(chunk.vectorBase64),
      }));
    }
    return this.splitIntoChunks(attachment).map(
      ({ content, location, order }) => ({ content, location, order }),
    );
  }

  private toPublicAttachment(
    attachment: StoredConversationAttachment,
  ): ConversationAttachment {
    return {
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      content: attachment.content,
      truncated: attachment.truncated,
      createdAt: attachment.createdAt,
    };
  }

  private async attachmentIds(ownerUserId: string, threadId: string) {
    const [current, legacy] = await Promise.all([
      this.redis.smembersRequired(this.indexKey(ownerUserId, threadId)),
      this.redis.smembersRequired(this.legacyIndexKey(ownerUserId, threadId)),
    ]);
    return [...new Set([...current, ...legacy])];
  }

  private embeddingText(
    attachment: ConversationAttachment,
    chunk: ConversationAttachmentChunk,
  ) {
    return `${attachment.filename}\n${chunk.location}\n${chunk.content}`;
  }

  private encodeVector(vector: number[]) {
    const bytes = Buffer.allocUnsafe(
      vector.length * Float32Array.BYTES_PER_ELEMENT,
    );
    vector.forEach((value, index) => {
      bytes.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
    });
    return bytes.toString('base64');
  }

  private decodeVector(value: string | undefined) {
    if (!value) return undefined;
    try {
      const bytes = Buffer.from(value, 'base64');
      if (
        bytes.length === 0 ||
        bytes.length % Float32Array.BYTES_PER_ELEMENT !== 0
      ) {
        return undefined;
      }
      const vector = Array.from(
        { length: bytes.length / Float32Array.BYTES_PER_ELEMENT },
        (_, index) => bytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT),
      );
      return this.isValidVector(vector) ? vector : undefined;
    } catch {
      return undefined;
    }
  }

  private isValidVector(vector: number[] | undefined): vector is number[] {
    return Boolean(
      vector?.length && vector.every((value) => Number.isFinite(value)),
    );
  }

  private indexKey(ownerUserId: string, threadId: string) {
    return `qa:conversation-attachments:v2:${this.ownerKey(ownerUserId)}:${threadId}:index`;
  }

  private attachmentKey(ownerUserId: string, threadId: string, id: string) {
    return `qa:conversation-attachments:v2:${this.ownerKey(ownerUserId)}:${threadId}:${id}`;
  }

  private legacyIndexKey(ownerUserId: string, threadId: string) {
    return `qa:conversation-attachments:v1:${this.ownerKey(ownerUserId)}:${threadId}:index`;
  }

  private legacyAttachmentKey(
    ownerUserId: string,
    threadId: string,
    id: string,
  ) {
    return `qa:conversation-attachments:v1:${this.ownerKey(ownerUserId)}:${threadId}:${id}`;
  }

  private ownerKey(ownerUserId: string) {
    return createHash('sha256').update(ownerUserId).digest('hex').slice(0, 24);
  }

  private safeFilename(filename: string) {
    return filename.replace(/[\r\n/\\[\]]/g, '_').slice(0, 180);
  }
}
