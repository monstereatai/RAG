import type { StructuredChunk } from './chunking.util';

export type GameDocumentType =
  | 'prd'
  | 'api'
  | 'design'
  | 'test'
  | 'config'
  | 'postmortem'
  | 'general';

export type DocumentLifecycleStatus =
  | 'draft'
  | 'confirmed'
  | 'effective'
  | 'deprecated'
  | 'archived';

export interface GameDocumentMetadata {
  projectId: string | null;
  activityId: string | null;
  region: string | null;
  locale: string | null;
  channel: string | null;
  roleScope: string[];
  documentType: GameDocumentType;
  lifecycleStatus: DocumentLifecycleStatus;
  supersedesDocId: string | null;
}

export type DocumentBusinessMetadata = Partial<GameDocumentMetadata> & {
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
};

export type ResolvedDocumentBusinessMetadata = GameDocumentMetadata & {
  docVersion: string | null;
  effectiveAt: string | null;
  expiredAt: string | null;
};

export interface ChunkStrategy {
  chunkSize: number;
  chunkOverlap: number;
  semanticBoundaries: boolean;
}

export interface IngestionQualityReport {
  score: number;
  accepted: boolean;
  warnings: string[];
  stats: {
    characters: number;
    headings: number;
    tableRows: number;
    codeBlocks: number;
    chunks: number;
    averageChunkLength: number;
    maxChunkLength: number;
    duplicateChunkRatio: number;
    replacementCharacterRatio: number;
  };
}

export interface ChunkStrategyEvaluation {
  chunkCount: number;
  averageChunkLength: number;
  overlapRatio: number;
  semanticBoundaryRate: number;
  score: number;
}

/**
 * 文档类型与切块策略的唯一映射。不同类型的结构密度不同：API／配置更重视完整段落，
 * PRD／复盘需要更多相邻上下文；overlap 统一控制在 chunkSize 的 10%～20% 之间，
 * 以接近 token 重叠目标（当前切分器按字符预算）并避免相邻事实被截断。
 */
const STRATEGIES: Record<GameDocumentType, ChunkStrategy> = {
  prd: { chunkSize: 650, chunkOverlap: 100, semanticBoundaries: true },
  api: { chunkSize: 700, chunkOverlap: 105, semanticBoundaries: true },
  design: { chunkSize: 600, chunkOverlap: 90, semanticBoundaries: true },
  test: { chunkSize: 550, chunkOverlap: 83, semanticBoundaries: true },
  config: { chunkSize: 700, chunkOverlap: 105, semanticBoundaries: true },
  postmortem: { chunkSize: 700, chunkOverlap: 105, semanticBoundaries: true },
  general: { chunkSize: 500, chunkOverlap: 75, semanticBoundaries: true },
};

/** 从文件名和正文抽取可用于权限、版本和检索范围过滤的业务元数据；无法确认时返回安全默认值。 */
export function detectGameDocumentMetadata(
  filename: string,
  content: string,
): GameDocumentMetadata {
  const haystack = `${filename}\n${content}`;
  return {
    projectId: extractField(haystack, ['projectId', '项目ID', '项目编号']),
    activityId: extractField(haystack, ['activityId', '活动ID', '活动编号']),
    region: extractField(haystack, ['region', '地区', '区域']),
    locale: extractField(haystack, ['locale', '语言', '语种']),
    channel: extractField(haystack, ['channel', '渠道']),
    roleScope: extractListField(haystack, [
      'roleScope',
      '适用角色',
      '角色范围',
    ]),
    documentType: detectDocumentType(haystack),
    lifecycleStatus: detectLifecycleStatus(haystack),
    supersedesDocId: extractField(haystack, [
      'supersedesDocId',
      '替代文档',
      '替代版本',
    ]),
  };
}

export function getChunkStrategy(type: GameDocumentType): ChunkStrategy {
  return STRATEGIES[type];
}

/** 对切分实验给出可比较的离线分数，不代表线上准确率。 */
export function evaluateChunkStrategy(
  source: string,
  chunks: StructuredChunk[],
  strategy: ChunkStrategy,
): ChunkStrategyEvaluation {
  const lengths = chunks.map((chunk) => chunk.content.length);
  const averageChunkLength = lengths.length
    ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length
    : 0;
  const targetOverlap = strategy.chunkOverlap / Math.max(strategy.chunkSize, 1);
  const overlapRatio = Math.min(1, targetOverlap);
  const boundaries = chunks.filter((chunk) =>
    /[。！？.!?]$/.test(chunk.content.trim()),
  ).length;
  const semanticBoundaryRate = chunks.length ? boundaries / chunks.length : 0;
  const sizeScore = averageChunkLength <= strategy.chunkSize ? 1 : 0;
  const score = Number(
    (
      (semanticBoundaryRate * 0.6 +
        (overlapRatio >= 0.1 && overlapRatio <= 0.2 ? 1 : 0) * 0.3 +
        sizeScore * 0.1) *
      100
    ).toFixed(2),
  );
  // 读取 source 参与评测契约，避免空文档被误判为高分。
  if (!source.trim() || chunks.length === 0) {
    return {
      chunkCount: chunks.length,
      averageChunkLength,
      overlapRatio,
      semanticBoundaryRate,
      score: 0,
    };
  }
  return {
    chunkCount: chunks.length,
    averageChunkLength,
    overlapRatio,
    semanticBoundaryRate,
    score,
  };
}

/**
 * 入库质量门禁：检测空内容、重复切块、乱码替换字符和异常长度，
 * 防止低质量资料污染向量、全文与本地索引。该报告会持久化供后台解释拒绝原因。
 */
export function assessIngestionQuality(
  content: string,
  chunks: StructuredChunk[],
): IngestionQualityReport {
  const normalizedChunks = chunks
    .map((chunk) => chunk.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const uniqueChunks = new Set(normalizedChunks);
  const duplicateChunkRatio =
    normalizedChunks.length === 0
      ? 0
      : 1 - uniqueChunks.size / normalizedChunks.length;
  const replacementCharacters = (content.match(/�/g) ?? []).length;
  const replacementCharacterRatio =
    content.length === 0 ? 0 : replacementCharacters / content.length;
  const lengths = chunks.map((chunk) => chunk.content.length);
  const maxChunkLength = Math.max(...lengths, 0);
  const averageChunkLength =
    lengths.length === 0
      ? 0
      : Math.round(
          lengths.reduce((sum, value) => sum + value, 0) / lengths.length,
        );
  const warnings: string[] = [];

  if (content.trim().length < 40) warnings.push('文档正文过短，召回价值有限');
  if (!/^#{1,6}\s+/m.test(content)) warnings.push('未检测到标题结构');
  if (replacementCharacterRatio > 0.01) warnings.push('疑似存在解析乱码');
  if (maxChunkLength > 2_000) warnings.push('存在超过 2000 字符的原子 Chunk');
  if (duplicateChunkRatio >= 0.2) warnings.push('重复 Chunk 比例较高');
  if (chunks.length === 0) warnings.push('未生成任何 Chunk');

  const score = Math.max(
    0,
    100 -
      warnings.length * 10 -
      Math.round(replacementCharacterRatio * 100) -
      Math.round(duplicateChunkRatio * 20),
  );

  return {
    score,
    accepted:
      content.trim().length >= 40 &&
      chunks.length > 0 &&
      replacementCharacterRatio <= 0.05 &&
      duplicateChunkRatio < 0.6,
    warnings,
    stats: {
      characters: content.length,
      headings: (content.match(/^#{1,6}\s+/gm) ?? []).length,
      tableRows: (content.match(/^\s*\|.+\|\s*$/gm) ?? []).length,
      codeBlocks: Math.floor((content.match(/^\s*```/gm) ?? []).length / 2),
      chunks: chunks.length,
      averageChunkLength,
      maxChunkLength,
      duplicateChunkRatio: roundRatio(duplicateChunkRatio),
      replacementCharacterRatio: roundRatio(replacementCharacterRatio),
    },
  };
}

function detectDocumentType(haystack: string): GameDocumentType {
  const lower = haystack.toLowerCase();
  if (/(测试用例|测试方案|预期结果|test case|qa checklist)/i.test(lower)) {
    return 'test';
  }
  if (
    /(接口文档|请求参数|响应参数|错误码|openapi|swagger|\bapi\b)/i.test(lower)
  ) {
    return 'api';
  }
  if (
    /(设计规范|视觉规范|素材尺寸|交互说明|design spec|ui spec)/i.test(lower)
  ) {
    return 'design';
  }
  if (/(配置表|概率表|奖池|活动配置|config)/i.test(lower)) return 'config';
  if (/(复盘|事故报告|根因|改进项|postmortem|retrospective)/i.test(lower)) {
    return 'postmortem';
  }
  if (/(产品需求|需求文档|业务规则|验收标准|\bprd\b)/i.test(lower)) {
    return 'prd';
  }
  return 'general';
}

function detectLifecycleStatus(haystack: string): DocumentLifecycleStatus {
  if (/(废弃|废止|已失效|deprecated)/i.test(haystack)) return 'deprecated';
  if (/(草稿|待评审|draft)/i.test(haystack)) return 'draft';
  if (/(已确认|评审通过|confirmed)/i.test(haystack)) return 'confirmed';
  return 'effective';
}

function extractField(text: string, names: string[]): string | null {
  const escaped = names.map(escapeRegExp).join('|');
  const match = new RegExp(
    `(?:^|\\n)\\s*(?:${escaped})\\s*[:：]\\s*([^\\n]+)`,
    'i',
  ).exec(text);
  return match?.[1]?.trim().slice(0, 128) || null;
}

function extractListField(text: string, names: string[]): string[] {
  const value = extractField(text, names);
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[,，、/|]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
