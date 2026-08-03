import type { ArtifactKind } from '../../providers/db/entities/generated-artifact.entity';

export interface ArtifactIntent {
  kind: ArtifactKind;
  title: string;
}

const ACTION_PATTERN =
  /(?:生成|导出|制作|创建|整理成|转换?成|输出|给我(?:一份|一个)?|做成|产出)/i;

const KIND_PATTERNS: Array<[ArtifactKind, RegExp]> = [
  ['word', /(?:\bword\b|\bworld\b|\bdocx\b|Word\s*文档)/i],
  ['excel', /(?:\bexcel\b|\bxlsx\b|电子表格|Excel\s*表格)/i],
  ['markdown', /(?:\bmarkdown\b|\bmd\b|Markdown\s*文档)/i],
  ['architecture', /(?:架构图|流程图|技术图|\.svg\b)/i],
  ['image', /(?:图片|配图|海报|主视觉|\.png\b|\.jpe?g\b)/i],
];

export function parseArtifactIntent(query: string): ArtifactIntent | null {
  const normalized = query.trim();
  if (!normalized || !ACTION_PATTERN.test(normalized)) return null;
  if (
    /(?:怎么|如何).{0,12}(?:生成|导出|制作|创建|转换|输出)/i.test(normalized)
  ) {
    return null;
  }

  const kind = KIND_PATTERNS.find(([, pattern]) =>
    pattern.test(normalized),
  )?.[0];
  if (!kind) return null;

  return {
    kind,
    title: buildArtifactTitle(normalized, kind),
  };
}

function buildArtifactTitle(query: string, kind: ArtifactKind): string {
  const cleaned = query
    .replace(ACTION_PATTERN, '')
    .replace(
      KIND_PATTERNS.find(([candidate]) => candidate === kind)?.[1] ?? /$^/,
      '',
    )
    .replace(/[，。！？、,.!?：:；;]+/g, ' ')
    .replace(/(?:文件|文档|一份|一个|给我|帮我|请)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || defaultTitle(kind)).slice(0, 120);
}

function defaultTitle(kind: ArtifactKind): string {
  return {
    markdown: 'AI 问答 Markdown',
    word: 'AI 问答 Word',
    excel: 'AI 问答 Excel',
    architecture: 'AI 问答架构图',
    image: 'AI 问答图片',
  }[kind];
}
