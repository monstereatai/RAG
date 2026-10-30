import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import type {
  ObsidianAccessContext,
  ObsidianGraphSeed,
  ObsidianNoteDraft,
  ObsidianSearchHit,
} from './obsidian-knowledge.types';

export abstract class ObsidianKnowledgeFileSupport {
  protected abstract readonly config: ConfigService;

  protected canReadFrontmatter(
    frontmatter: Record<string, unknown>,
    access: ObsidianAccessContext,
  ): boolean {
    const userId = access.userId;
    const roles = access?.roles ?? [];
    const users = this.frontmatterTags(
      frontmatter.allowed_users ?? frontmatter.allowedUsers,
    );
    const allowedRoles = this.frontmatterTags(
      frontmatter.allowed_roles ?? frontmatter.allowedRoles,
    );
    if (users.length === 0 && allowedRoles.length === 0) return true;
    return Boolean(
      (userId && users.includes(userId)) ||
      roles.some((role) => allowedRoles.includes(role)),
    );
  }

  protected assertAccessContext(
    access: ObsidianAccessContext,
  ): asserts access is ObsidianAccessContext & { userId: string } {
    if (!access?.userId?.trim()) {
      throw new ForbiddenException('Obsidian access context is required');
    }
  }

  protected buildGraphSeed(
    notes: Array<{ path: string; content: string }>,
  ): ObsidianGraphSeed {
    const nodes = new Map<string, ObsidianGraphSeed['nodes'][number]>();
    const relationships = new Map<
      string,
      ObsidianGraphSeed['relationships'][number]
    >();

    for (const note of notes) {
      const frontmatter = this.parseFrontmatter(note.content);
      const title = String(
        frontmatter.title ||
          this.titleFromMarkdown(note.content) ||
          basename(note.path, '.md'),
      );
      const sourceId =
        this.frontmatterString(frontmatter.rag_doc_id) ??
        this.vaultRelative(note.path);
      const topics = this.frontmatterTags(frontmatter.topics);
      const entities = this.frontmatterTags(frontmatter.entities);
      const tags = this.frontmatterTags(frontmatter.tags);

      for (const topic of topics) {
        this.addGraphNode(nodes, topic, 'Topic', sourceId);
      }
      for (const entity of entities) {
        this.addGraphNode(nodes, entity, 'Entity', sourceId);
      }
      for (const tag of tags) {
        this.addGraphNode(nodes, tag, 'Tag', sourceId);
      }
      this.addGraphNode(nodes, title, 'SourceNote', sourceId);

      for (const entity of entities) {
        for (const topic of topics) {
          this.addGraphRelationship(
            relationships,
            entity,
            topic,
            'MENTIONS_TOPIC',
            sourceId,
            0.75,
          );
        }
        this.addGraphRelationship(
          relationships,
          entity,
          title,
          'APPEARS_IN',
          sourceId,
          0.7,
        );
      }
      for (const topic of topics) {
        for (const tag of tags) {
          this.addGraphRelationship(
            relationships,
            topic,
            tag,
            'TAGGED_AS',
            sourceId,
            0.65,
          );
        }
      }
    }

    return {
      nodes: [...nodes.values()],
      relationships: [...relationships.values()],
    };
  }

  protected async readAllNotes(): Promise<
    Array<{ path: string; content: string }>
  > {
    const files = await this.listMarkdownFiles(this.notesDir(), 'note');
    const notes: Array<{ path: string; content: string }> = [];
    for (const file of files) {
      notes.push({
        path: file.path,
        content: await readFile(file.path, 'utf8'),
      });
    }
    return notes;
  }

  protected isPublicFrontmatter(frontmatter: Record<string, unknown>): boolean {
    return (
      this.frontmatterTags(
        frontmatter.allowed_users ?? frontmatter.allowedUsers,
      ).length === 0 &&
      this.frontmatterTags(
        frontmatter.allowed_roles ?? frontmatter.allowedRoles,
      ).length === 0
    );
  }

  protected async findNoteByHash(
    contentHash: string,
    access: ObsidianAccessContext,
  ): Promise<string | null> {
    for (const file of await this.listMarkdownFiles(this.notesDir(), 'note')) {
      try {
        const content = await readFile(file.path, 'utf8');
        if (
          content.includes(`content_hash: "${contentHash}"`) &&
          this.canReadFrontmatter(this.parseFrontmatter(content), access)
        ) {
          return file.path;
        }
      } catch {
        // ignore unreadable note
      }
    }
    return null;
  }

  protected async listMarkdownFiles(
    dir: string,
    type: ObsidianSearchHit['type'],
  ): Promise<Array<{ path: string; type: ObsidianSearchHit['type'] }>> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const out: Array<{ path: string; type: ObsidianSearchHit['type'] }> = [];
      for (const entry of entries) {
        const path = resolve(dir, entry.name);
        this.assertInsideVault(path);
        if (entry.isDirectory()) {
          out.push(...(await this.listMarkdownFiles(path, type)));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          out.push({ path, type });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  protected parseFrontmatter(content: string): Record<string, unknown> {
    const match = /^---\n([\s\S]*?)\n---/.exec(content);
    if (!match) return {};
    const data: Record<string, unknown> = {};
    for (const line of match[1].split('\n')) {
      const index = line.indexOf(':');
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (value.startsWith('[') && value.endsWith(']')) {
        data[key] = value
          .slice(1, -1)
          .split(',')
          .map((item) => item.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      } else {
        data[key] = value.replace(/^"|"$/g, '');
      }
    }
    return data;
  }

  protected normalizeDraft(value: unknown): ObsidianNoteDraft {
    const draft = (value && typeof value === 'object' ? value : {}) as Partial<
      Record<keyof ObsidianNoteDraft, unknown>
    >;
    const summary = this.cleanStringArray(draft.summary).slice(0, 3);
    const keyPoints = this.cleanStringArray(draft.keyPoints).slice(0, 5);
    const tags = [...new Set(this.cleanStringArray(draft.tags))]
      .map((tag) => tag.replace(/^#/, '').trim())
      .filter(Boolean)
      .slice(0, 5);
    const keyConclusions = this.cleanStringArray(draft.keyConclusions).slice(
      0,
      5,
    );
    const topics = [...new Set(this.cleanStringArray(draft.topics))]
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
    const entities = [...new Set(this.cleanStringArray(draft.entities))]
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
    const objections = this.cleanStringArray(draft.objections).slice(0, 5);
    const boundaries = this.cleanStringArray(draft.boundaries).slice(0, 5);
    const risks = this.cleanStringArray(draft.risks).slice(0, 5);
    const acceptanceCriteria = this.cleanStringArray(
      draft.acceptanceCriteria,
    ).slice(0, 5);

    return {
      summary: summary.length > 0 ? summary : ['资料已存入个人知识库。'],
      keyPoints:
        keyPoints.length > 0 ? keyPoints : ['正文已保留，可回到原文继续分析。'],
      tags,
      topics,
      entities,
      keyConclusions,
      objections,
      boundaries,
      risks,
      acceptanceCriteria,
    };
  }

  protected heuristicDraft(content: string, title: string): ObsidianNoteDraft {
    const plain = content
      .replace(/^# .+$/gm, '')
      .replace(/\[[^\]]+\]\([^)]+\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const sentences = plain
      .split(/(?<=[。！？.!?])\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 12)
      .slice(0, 3);
    const headings = [
      ...content.matchAll(/^#{2,4}\s+(.+)$/gm),
      ...content.matchAll(/^- (.+)$/gm),
    ]
      .map((match) => match[1].trim())
      .filter((item) => item.length >= 4)
      .slice(0, 5);
    return {
      summary: sentences.length > 0 ? sentences : ['资料已存入个人知识库。'],
      keyPoints:
        headings.length > 0 ? headings : ['正文已保留，可回到原文继续分析。'],
      tags: this.inferTags(`${title}\n${content}`),
      topics: this.inferTopics(`${title}\n${content}`),
      entities: this.inferEntities(`${title}\n${content}`),
      keyConclusions: headings.slice(0, 3),
      objections: this.extractLinesByKeywords(content, [
        '反对',
        '问题',
        '不足',
        '缺点',
      ]),
      boundaries: this.extractLinesByKeywords(content, [
        '适用',
        '边界',
        '前提',
        '约束',
      ]),
      risks: this.extractLinesByKeywords(content, [
        '风险',
        '失败',
        '瓶颈',
        '复杂',
      ]),
      acceptanceCriteria: this.extractLinesByKeywords(content, [
        '验收',
        '指标',
        '标准',
        '完成',
      ]),
    };
  }

  protected inferTags(text: string): string[] {
    const candidates: Array<[RegExp, string]> = [
      [/AI|人工智能|大模型|LLM/i, 'AI'],
      [/产品|MVP|需求|用户|体验/i, '产品'],
      [/架构|系统|链路|数据流/i, '架构'],
      [/技术|框架|工程|代码|开发/i, '技术'],
      [/React/i, 'React'],
      [/Vue/i, 'Vue'],
      [/NestJS/i, 'NestJS'],
      [/JavaScript|TypeScript|JS/i, 'JavaScript'],
      [/知识库|Obsidian|RAG|RAG/i, '知识库'],
      [/写作|选题|内容|文章/i, '写作'],
    ];
    return candidates
      .filter(([pattern]) => pattern.test(text))
      .map(([, tag]) => tag)
      .slice(0, 5);
  }

  protected inferTopics(text: string): string[] {
    return this.inferTags(text).slice(0, 5);
  }

  protected inferEntities(text: string): string[] {
    const english =
      text.match(/\b[A-Z][A-Za-z0-9]*(?:[.-]?[A-Z][A-Za-z0-9]*)*\b/g) ?? [];
    const chinese =
      text.match(
        /(?:React|Vue|NestJS|TypeScript|JavaScript|Milvus|Neo4j|Redis|PostgreSQL|Elasticsearch|Obsidian|RAG|RAG|GraphRAG|Agentic|LangChain|OpenAI|DeepSeek|Qwen|Docker|Node\.js)/gi,
      ) ?? [];
    return [...new Set([...english, ...chinese])]
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
      .slice(0, 8);
  }

  protected sectionList(content: string, heading: string): string[] {
    return this.extractSection(content, heading)
      .split('\n')
      .map((line) => line.replace(/^[-*\s]+/, '').trim())
      .filter((line) => line.length > 0 && line !== '暂无明确内容')
      .slice(0, 20);
  }

  protected mergeSectionItems(sections: string[]): string[] {
    const items = [
      ...new Set(
        sections.flatMap((section) =>
          section
            .split('\n')
            .map((line) => line.replace(/^[-*\s]+/, '').trim())
            .filter((line) => line.length > 0 && line !== '暂无明确内容'),
        ),
      ),
    ];
    return items.length > 0
      ? items.map((item) => `- ${item}`)
      : ['- 暂无明确内容'];
  }

  protected detectVersionConflicts(lines: string[]): string[] {
    const normalizedLines = lines
      .flatMap((line) => line.split('\n'))
      .map((line) => line.trim())
      .filter(Boolean);
    const years = new Set(
      normalizedLines.flatMap((line) => line.match(/20\d{2}/g) ?? []),
    );
    const conflictSignals: string[] = [];
    const pairs: Array<[RegExp, RegExp, string]> = [
      [
        /推荐|建议|应该|必须|采用|允许|可以/,
        /不推荐|不建议|不应该|禁止|避免|不可|不能/,
        '同一结论附近同时出现正反决策词',
      ],
      [
        /生效|最新|优先|当前/,
        /历史|废弃|过期|失效|旧版/,
        '同一结论附近同时出现新旧版本词',
      ],
      [
        /必须|强制|required/i,
        /可选|非必须|optional/i,
        '同一结论附近同时出现强制和可选词',
      ],
    ];
    for (const [positive, negative, reason] of pairs) {
      if (
        normalizedLines.some((line) => positive.test(line)) &&
        normalizedLines.some((line) => negative.test(line))
      ) {
        conflictSignals.push(`- ${reason}，需要回到 source note 核对上下文。`);
      }
    }

    if (years.size >= 2) {
      conflictSignals.unshift(
        `- 检测到多个年份/版本信号：${[...years].join('、')}，需要人工确认当前生效版本。`,
      );
    }
    return conflictSignals.length > 0
      ? [...new Set(conflictSignals)]
      : ['- 暂未检测到明显版本或语义冲突。'];
  }

  protected addGraphNode(
    nodes: Map<string, ObsidianGraphSeed['nodes'][number]>,
    id: string,
    type: string,
    sourceId: string,
  ): void {
    const key = `${type}:${id}`;
    if (!nodes.has(key)) {
      nodes.set(key, { id, label: type, type, sourceId });
    }
  }

  protected addGraphRelationship(
    relationships: Map<string, ObsidianGraphSeed['relationships'][number]>,
    source: string,
    target: string,
    type: string,
    sourceId: string,
    confidence: number,
  ): void {
    const key = `${source}->${type}->${target}`;
    if (!relationships.has(key)) {
      relationships.set(key, { source, target, type, sourceId, confidence });
    }
  }

  protected extractLinesByKeywords(
    content: string,
    keywords: string[],
  ): string[] {
    return content
      .split(/\n+|(?<=[。！？!?；;])/u)
      .map((line) => line.replace(/^[-#*\s]+/, '').trim())
      .filter((line) =>
        keywords.some((keyword) => line.toLowerCase().includes(keyword)),
      )
      .filter((line) => line.length >= 4)
      .slice(0, 5);
  }

  protected listOrEmpty(items: string[]): string[] {
    return items.length > 0
      ? items.map((item) => `- ${item}`)
      : ['- 暂无明确内容'];
  }

  protected extractSection(content: string, heading: string): string {
    const pattern = new RegExp(
      `^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`,
      'm',
    );
    return pattern.exec(content)?.[1]?.trim() ?? '';
  }

  protected scoreText(tokens: Set<string>, text: string): number {
    if (tokens.size === 0) return 0;
    const normalized = text.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (normalized.includes(token.toLowerCase())) score += 1;
    }
    return score;
  }

  protected snippet(content: string, tokens: Set<string>): string {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const matched = lines.filter((line) => this.scoreText(tokens, line) > 0);
    return (matched.length > 0 ? matched : lines)
      .slice(0, 8)
      .join('\n')
      .slice(0, 1600);
  }

  protected extractTokens(text: string): Set<string> {
    const normalized = text.normalize('NFKC').toLowerCase();
    const words =
      normalized.match(/[a-z0-9][a-z0-9._-]{1,}|[\u4e00-\u9fa5]{2,}/gi) ?? [];
    const stop = new Set([
      '什么',
      '怎么',
      '如何',
      '一下',
      '这个',
      '那个',
      '哪些',
      '是否',
    ]);
    return new Set(
      words
        .map((word) => word.trim())
        .filter((word) => word.length >= 2 && !stop.has(word)),
    );
  }

  protected cleanStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0)
      : [];
  }

  protected extractJson(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM response does not contain JSON');
    return match[0];
  }

  protected titleFromMarkdown(content: string): string | null {
    return /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? null;
  }

  protected frontmatterString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  protected frontmatterTags(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }

  protected async ensureVault(): Promise<void> {
    await mkdir(this.rawDir(), { recursive: true });
    await mkdir(this.notesDir(), { recursive: true });
    await mkdir(this.compiledDir(), { recursive: true });
    await mkdir(this.indexDir(), { recursive: true });
  }

  protected async nextAvailablePath(filePath: string): Promise<string> {
    let candidate = filePath;
    let index = 2;
    while (await this.exists(candidate)) {
      candidate = filePath.replace(/\.md$/, `-${index}.md`);
      index += 1;
    }
    return candidate;
  }

  protected async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  protected normalizeTitle(title: string): string {
    return title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  }

  protected safeFilename(title: string): string {
    return (
      this.normalizeTitle(title)
        .replace(/[\\/:*?"<>|#\[\]\n\r\t]+/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'untitled'
    );
  }

  protected hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  protected today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
    }).format(new Date());
  }

  protected yamlString(value: string): string {
    return JSON.stringify(value);
  }

  protected vaultRelative(filePath: string): string {
    return relative(this.vaultDir(), filePath).replace(/\\/g, '/');
  }

  protected rawDir(): string {
    return resolve(this.vaultDir(), 'raw');
  }

  protected notesDir(): string {
    return resolve(this.vaultDir(), 'notes');
  }

  protected compiledDir(): string {
    return resolve(this.vaultDir(), 'compiled');
  }

  protected indexDir(): string {
    return resolve(this.vaultDir(), 'index');
  }

  protected vaultDir(): string {
    return resolve(
      this.config.get<string>('obsidian.vaultDir') ??
        resolve(process.cwd(), '../../workspace/obsidian'),
    );
  }

  protected assertInsideVault(target: string): void {
    const root = this.vaultDir();
    const rel = relative(root, target);
    if (rel.startsWith('..') || rel === '' || resolve(root, rel) !== target) {
      throw new Error(`unsafe Obsidian path: ${target}`);
    }
  }
}
