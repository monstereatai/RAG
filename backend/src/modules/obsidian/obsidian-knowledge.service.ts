import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { LlmProvider } from '../../providers/llm/llm.provider';

export interface ObsidianNoteDraft {
  summary: string[];
  keyPoints: string[];
  tags: string[];
  topics: string[];
  entities: string[];
  keyConclusions: string[];
  objections: string[];
  boundaries: string[];
  risks: string[];
  acceptanceCriteria: string[];
}

export interface ObsidianSourceInput {
  title: string;
  sourceUrl?: string;
  content: string;
  ragDocId?: string;
  sourceType: 'url' | 'document' | 'official-docs' | 'manual';
  contentType?: string;
  filename?: string;
}

export interface ObsidianWriteResult {
  status: 'saved' | 'duplicate' | 'failed';
  notePath?: string;
  rawPath?: string;
  error?: string;
  title: string;
  tags: string[];
  contentHash: string;
  ragDocId?: string;
}

export interface ObsidianSearchHit {
  path: string;
  type: 'compiled' | 'index' | 'note';
  title: string;
  content: string;
  score: number;
  ragDocId?: string;
  sourceUrl?: string;
  tags: string[];
}

export type ProjectWorkflowType =
  | 'solution'
  | 'tech-selection'
  | 'adr'
  | 'task-breakdown';

export interface ProjectWorkflowInput {
  type: ProjectWorkflowType;
  title: string;
  question: string;
  context?: string;
  constraints?: string[];
  options?: string[];
}

export interface ProjectWorkflowResult {
  type: ProjectWorkflowType;
  title: string;
  path: string;
  obsidianPaths: string[];
  content: string;
}

export interface ObsidianSourceLookup {
  notePath: string;
  ragDocId?: string;
  title: string;
  tags: string[];
  contentHash: string;
}

export interface ObsidianGraphSeed {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    sourceId: string;
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    sourceId: string;
    confidence: number;
  }>;
}

@Injectable()
export class ObsidianKnowledgeService {
  private readonly logger = new Logger(ObsidianKnowledgeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly llmProvider: LlmProvider,
  ) {}

  async writeSource(input: ObsidianSourceInput): Promise<ObsidianWriteResult> {
    const content = input.content.trim();
    const contentHash = this.hash(content);
    const title = this.normalizeTitle(input.title);

    try {
      await this.ensureVault();
      const duplicate = await this.findNoteByHash(contentHash);
      if (duplicate) {
        const content = await readFile(duplicate, 'utf8');
        const frontmatter = this.parseFrontmatter(content);
        return {
          status: 'duplicate',
          notePath: duplicate,
          title,
          tags: this.frontmatterTags(frontmatter.tags),
          contentHash,
          ragDocId: this.frontmatterString(frontmatter.rag_doc_id),
        };
      }

      const draft = await this.buildDraft(content, title);
      const date = this.today();
      const rawPath = await this.writeRaw({
        date,
        title,
        content,
        sourceType: input.sourceType,
      });
      const notePath = await this.writeNote({
        ...input,
        title,
        content,
        contentHash,
        date,
        draft,
        rawPath,
      });
      await this.refreshIndexes();

      return {
        status: 'saved',
        notePath,
        rawPath,
        title,
        tags: draft.tags,
        contentHash,
        ragDocId: input.ragDocId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Obsidian write failed: ${message}`);
      return {
        status: 'failed',
        error: message,
        title,
        tags: [],
        contentHash,
      };
    }
  }

  async search(query: string, limit = 5): Promise<ObsidianSearchHit[]> {
    await this.ensureVault();
    const files = [
      ...(await this.listMarkdownFiles(this.compiledDir(), 'compiled')),
      ...(await this.listMarkdownFiles(this.indexDir(), 'index')),
      ...(await this.listMarkdownFiles(this.notesDir(), 'note')),
    ];
    const tokens = this.extractTokens(query);
    const hits: ObsidianSearchHit[] = [];

    for (const file of files) {
      const content = await readFile(file.path, 'utf8');
      const frontmatter = this.parseFrontmatter(content);
      const body = content.replace(/^---[\s\S]*?---\s*/m, '').trim();
      const score = this.scoreText(tokens, `${frontmatter.title ?? ''}\n${body}`);
      if (score <= 0) continue;
      hits.push({
        path: file.path,
        type: file.type,
        title: String(frontmatter.title || this.titleFromMarkdown(body) || basename(file.path, '.md')),
        content: this.snippet(body, tokens),
        score: file.type === 'compiled' ? score + 3 : file.type === 'index' ? score + 1 : score,
        ragDocId: this.frontmatterString(frontmatter.rag_doc_id),
        sourceUrl: this.frontmatterString(frontmatter.source_url),
        tags: this.frontmatterTags(frontmatter.tags),
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async findNoteByRagDocId(docId: string): Promise<string | null> {
    if (!docId.trim()) return null;
    for (const file of await this.listMarkdownFiles(this.notesDir(), 'note')) {
      try {
        const content = await readFile(file.path, 'utf8');
        if (content.includes(`rag_doc_id: "${docId}"`)) {
          return file.path;
        }
      } catch {
        // ignore unreadable note
      }
    }
    return null;
  }

  async findSourceByContentHash(
    contentOrHash: string,
  ): Promise<ObsidianSourceLookup | null> {
    const contentHash =
      /^[a-f0-9]{64}$/i.test(contentOrHash.trim())
        ? contentOrHash.trim()
        : this.hash(contentOrHash.trim());
    const notePath = await this.findNoteByHash(contentHash);
    if (!notePath) return null;
    const content = await readFile(notePath, 'utf8');
    const frontmatter = this.parseFrontmatter(content);
    return {
      notePath,
      ragDocId: this.frontmatterString(frontmatter.rag_doc_id),
      title: String(
        frontmatter.title || this.titleFromMarkdown(content) || basename(notePath, '.md'),
      ),
      tags: this.frontmatterTags(frontmatter.tags),
      contentHash,
    };
  }

  async exportGraphSeed(): Promise<ObsidianGraphSeed> {
    const notes = await this.readAllNotes();
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

  async generateProjectWorkflow(
    input: ProjectWorkflowInput,
  ): Promise<ProjectWorkflowResult> {
    await this.ensureVault();
    const title = this.normalizeTitle(input.title || input.question);
    const query = [input.question, input.context ?? '', ...(input.options ?? [])]
      .join('\n')
      .trim();
    const hits = await this.search(query, 8);
    const evidence = this.formatHitsForPrompt(hits);
    const body = await this.buildProjectWorkflowMarkdown(input, evidence);
    const date = this.today();
    const dir = resolve(this.compiledDir(), 'project-workflows', input.type);
    await mkdir(dir, { recursive: true });
    const filePath = await this.nextAvailablePath(
      resolve(dir, `${date}-${this.safeFilename(title)}.md`),
    );
    this.assertInsideVault(filePath);

    const markdown = [
      '---',
      `title: ${this.yamlString(title)}`,
      `type: ${this.yamlString(`project_${input.type}`)}`,
      `workflow_type: ${this.yamlString(input.type)}`,
      `date: ${this.yamlString(date)}`,
      `source_paths: [${hits.map((hit) => this.yamlString(this.vaultRelative(hit.path))).join(', ')}]`,
      `tags: [${this.yamlString('项目决策')}, ${this.yamlString(this.workflowLabel(input.type))}]`,
      '---',
      '',
      `# ${title}`,
      '',
      `类型：${this.workflowLabel(input.type)}`,
      '',
      '## 输入',
      '',
      `问题：${input.question}`,
      '',
      input.context ? `背景：${input.context}` : null,
      '',
      input.constraints?.length
        ? ['约束：', ...input.constraints.map((item) => `- ${item}`)].join('\n')
        : null,
      '',
      input.options?.length
        ? ['候选方案：', ...input.options.map((item) => `- ${item}`)].join('\n')
        : null,
      '',
      '## Obsidian 证据',
      '',
      ...(hits.length
        ? hits.map(
            (hit) =>
              `- [[${this.vaultRelative(hit.path).replace(/\.md$/, '')}|${hit.title}]]（${hit.type}，score: ${hit.score}）`,
          )
        : ['- 暂无命中，已按输入内容生成初稿']),
      '',
      body,
      '',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    await writeFile(filePath, markdown, 'utf8');
    await this.refreshProjectWorkflowIndex();

    return {
      type: input.type,
      title,
      path: filePath,
      obsidianPaths: hits.map((hit) => hit.path),
      content: markdown,
    };
  }

  formatHitsForPrompt(hits: ObsidianSearchHit[]): string {
    if (hits.length === 0) return '';
    return hits
      .map(
        (hit, index) =>
          `[Obsidian ${index + 1}] ${hit.title}\npath: ${hit.path}\ntype: ${hit.type}\ntags: ${hit.tags.join(', ') || 'none'}\n${hit.content}`,
      )
      .join('\n\n---\n\n');
  }

  assessHits(query: string, hits: ObsidianSearchHit[]): {
    sufficient: boolean;
    reason: string;
  } {
    if (hits.length === 0) {
      return { sufficient: false, reason: 'Obsidian 未命中长期知识' };
    }
    const tokens = this.extractTokens(query);
    const best = Math.max(...hits.map((hit) => this.scoreText(tokens, hit.content)));
    if (best < 2 && tokens.size >= 2) {
      return {
        sufficient: false,
        reason: `Obsidian 命中弱，最高关键词覆盖 ${best}`,
      };
    }
    return { sufficient: true, reason: 'Obsidian compiled/index 或 source note 命中' };
  }

  private async buildDraft(
    content: string,
    title: string,
  ): Promise<ObsidianNoteDraft> {
    try {
      const response = await this.llmProvider.invoke([
        {
          role: 'system',
          content:
            '你是个人知识库整理助手。只返回 JSON，不要 Markdown，不要解释。',
        },
        {
          role: 'user',
          content: [
            '请完整阅读下面文章，生成个人知识库笔记元信息。',
            '要求：',
            '1. summary 写 2-3 句话，每句话独立成数组项。',
            '2. keyPoints 写 3-5 条要点。',
            '3. tags 写 3-5 个中文标签，不够就少写，别硬凑。',
            '4. topics 写 2-5 个主题，entities 写 2-8 个人/产品/公司/技术/模块实体。',
            '5. keyConclusions 写关键结论，objections 写反对意见，boundaries 写适用边界，risks 写落地风险，acceptanceCriteria 写验收口径。',
            '6. 只返回 JSON：{"summary":[],"keyPoints":[],"tags":[],"topics":[],"entities":[],"keyConclusions":[],"objections":[],"boundaries":[],"risks":[],"acceptanceCriteria":[]}',
            '',
            `标题：${title}`,
            '',
            '正文：',
            content.slice(0, 20_000),
          ].join('\n'),
        },
      ]);
      return this.normalizeDraft(JSON.parse(this.extractJson(response)));
    } catch (error) {
      this.logger.warn(
        `Obsidian draft failed, fallback to heuristic: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.heuristicDraft(content, title);
    }
  }

  private async writeRaw(params: {
    date: string;
    title: string;
    content: string;
    sourceType: string;
  }): Promise<string> {
    const dir = resolve(this.rawDir(), params.sourceType);
    await mkdir(dir, { recursive: true });
    const filePath = await this.nextAvailablePath(
      resolve(dir, `${params.date}-${this.safeFilename(params.title)}.md`),
    );
    this.assertInsideVault(filePath);
    await writeFile(filePath, params.content, 'utf8');
    return filePath;
  }

  private async writeNote(params: ObsidianSourceInput & {
    date: string;
    contentHash: string;
    draft: ObsidianNoteDraft;
    rawPath: string;
  }): Promise<string> {
    const notesDir = this.notesDir();
    await mkdir(notesDir, { recursive: true });

    const filePath = await this.nextAvailablePath(
      resolve(notesDir, `${params.date}-${this.safeFilename(params.title)}.md`),
    );
    this.assertInsideVault(filePath);

    const rawRel = this.vaultRelative(params.rawPath);
    const markdown = [
      '---',
      `title: ${this.yamlString(params.title)}`,
      params.sourceUrl ? `source_url: ${this.yamlString(params.sourceUrl)}` : null,
      `tags: [${params.draft.tags.map((tag) => this.yamlString(tag)).join(', ')}]`,
      `topics: [${params.draft.topics.map((item) => this.yamlString(item)).join(', ')}]`,
      `entities: [${params.draft.entities.map((item) => this.yamlString(item)).join(', ')}]`,
      `date: ${this.yamlString(params.date)}`,
      params.ragDocId ? `rag_doc_id: ${this.yamlString(params.ragDocId)}` : null,
      `content_hash: ${this.yamlString(params.contentHash)}`,
      `source_type: ${this.yamlString(params.sourceType)}`,
      params.contentType ? `content_type: ${this.yamlString(params.contentType)}` : null,
      params.filename ? `filename: ${this.yamlString(params.filename)}` : null,
      `raw_path: ${this.yamlString(rawRel)}`,
      'type: source_note',
      '---',
      '',
      `# ${params.title}`,
      '',
      params.sourceUrl ? `原链接：${params.sourceUrl}` : null,
      '',
      `日期：${params.date}`,
      '',
      `标签：${params.draft.tags.join('、') || '无'}`,
      '',
      '## 摘要',
      '',
      ...params.draft.summary.map((item) => `- ${item}`),
      '',
      '## 要点',
      '',
      ...params.draft.keyPoints.map((item) => `- ${item}`),
      '',
      '## 关键结论',
      '',
      ...this.listOrEmpty(params.draft.keyConclusions),
      '',
      '## 反对意见',
      '',
      ...this.listOrEmpty(params.draft.objections),
      '',
      '## 适用边界',
      '',
      ...this.listOrEmpty(params.draft.boundaries),
      '',
      '## 落地风险',
      '',
      ...this.listOrEmpty(params.draft.risks),
      '',
      '## 验收口径',
      '',
      ...this.listOrEmpty(params.draft.acceptanceCriteria),
      '',
      '## 正文',
      '',
      params.content,
      '',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    await writeFile(filePath, markdown, 'utf8');
    return filePath;
  }

  private async refreshIndexes(): Promise<void> {
    const notes = await this.readAllNotes();
    await mkdir(this.indexDir(), { recursive: true });
    await mkdir(this.compiledDir(), { recursive: true });

    const tags = new Map<string, Array<{ title: string; path: string; summary: string }>>();
    const entities = new Map<string, Array<{ title: string; path: string; summary: string }>>();
    const conclusions: Array<{
      title: string;
      path: string;
      conclusion: string;
      risks: string;
      acceptance: string;
      openQuestions: string;
    }> = [];
    const noteRecords: Array<{
      title: string;
      path: string;
      tags: string[];
      topics: string[];
      entities: string[];
      content: string;
    }> = [];
    const sources: string[] = [];

    for (const note of notes) {
      const frontmatter = this.parseFrontmatter(note.content);
      const title = String(frontmatter.title || this.titleFromMarkdown(note.content) || basename(note.path, '.md'));
      const summary = this.extractSection(note.content, '摘要').split('\n').slice(0, 4).join('\n');
      const noteTags = this.frontmatterTags(frontmatter.tags);
      const noteTopics = this.frontmatterTags(frontmatter.topics);
      const noteEntities = this.frontmatterTags(frontmatter.entities);
      noteRecords.push({
        title,
        path: note.path,
        tags: noteTags,
        topics: noteTopics,
        entities: noteEntities,
        content: note.content,
      });
      sources.push(`- [[${this.vaultRelative(note.path).replace(/\.md$/, '')}|${title}]]`);
      for (const tag of noteTags) {
        const list = tags.get(tag) ?? [];
        list.push({ title, path: note.path, summary });
        tags.set(tag, list);
      }
      for (const entity of noteEntities) {
        const list = entities.get(entity) ?? [];
        list.push({ title, path: note.path, summary });
        entities.set(entity, list);
      }
      for (const conclusion of this.sectionList(note.content, '关键结论')) {
        conclusions.push({
          title,
          path: note.path,
          conclusion,
          risks: this.extractSection(note.content, '落地风险'),
          acceptance: this.extractSection(note.content, '验收口径'),
          openQuestions: [
            this.extractSection(note.content, '反对意见'),
            this.extractSection(note.content, '适用边界'),
          ]
            .filter(Boolean)
            .join('\n'),
        });
      }
    }

    await writeFile(
      resolve(this.indexDir(), 'sources.md'),
      ['# Sources Index', '', ...sources.sort(), ''].join('\n'),
      'utf8',
    );
    await writeFile(
      resolve(this.indexDir(), 'tags.md'),
      [
        '# Tags Index',
        '',
        ...[...tags.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tag, list]) => `## ${tag}\n\n${list.map((item) => `- [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]]`).join('\n')}`)
          .flatMap((block) => [block, '']),
      ].join('\n'),
      'utf8',
    );

    for (const [tag, list] of tags) {
      const filePath = resolve(this.compiledDir(), `${this.safeFilename(tag)}.md`);
      this.assertInsideVault(filePath);
      await writeFile(
        filePath,
        [
          '---',
          `title: ${this.yamlString(tag)}`,
          `tags: [${this.yamlString(tag)}, ${this.yamlString('compiled')}]`,
          'type: compiled',
          `updated_at: ${this.yamlString(new Date().toISOString())}`,
          '---',
          '',
          `# ${tag}`,
          '',
          ...list.map((item) =>
            [
              `## [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]]`,
              '',
              item.summary || '- 暂无摘要',
              '',
            ].join('\n'),
          ),
          '',
        ].join('\n'),
        'utf8',
      );
    }

    await this.writeEntityCompiledPages(entities);
    await this.writeConclusionCompiledPages(conclusions);
    await this.writeGraphSeedIndex();

    await this.refreshRelated(noteRecords);
  }

  private async refreshRelated(
    notes: Array<{
      title: string;
      path: string;
      tags: string[];
      topics: string[];
      entities: string[];
      content: string;
    }>,
  ): Promise<void> {
    const logLines = ['# Related Update Log', '', `updatedAt: ${new Date().toISOString()}`, ''];

    for (const note of notes) {
      const related = notes
        .filter((candidate) => candidate.path !== note.path)
        .map((candidate) => {
          const sharedTags = candidate.tags.filter((tag) =>
            note.tags.includes(tag),
          );
          const sharedTopics = candidate.topics.filter((topic) =>
            note.topics.includes(topic),
          );
          const sharedEntities = candidate.entities.filter((entity) =>
            note.entities.includes(entity),
          );
          const score =
            sharedTags.length +
            sharedTopics.length * 2 +
            sharedEntities.length * 3;
          const reasons = [
            sharedEntities.length ? `共享实体：${sharedEntities.join('、')}` : '',
            sharedTopics.length ? `共享主题：${sharedTopics.join('、')}` : '',
            sharedTags.length ? `共享标签：${sharedTags.join('、')}` : '',
          ].filter(Boolean);
          return {
            ...candidate,
            score,
            reason: reasons.join('；'),
          };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      await writeFile(
        note.path,
        this.upsertRelatedSection(note.content, related),
        'utf8',
      );

      logLines.push(`## ${note.title}`, '');
      if (related.length === 0) {
        logLines.push('- 无候选关联', '');
      } else {
        for (const item of related) {
          logLines.push(
            `- [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]] score=${item.score}; reason=${item.reason}`,
          );
        }
        logLines.push('');
      }
    }

    const logDir = resolve(this.vaultDir(), '90-system', 'logs');
    await mkdir(logDir, { recursive: true });
    const logPath = resolve(logDir, `related-${this.today()}.md`);
    this.assertInsideVault(logPath);
    await writeFile(logPath, logLines.join('\n'), 'utf8');
  }

  private upsertRelatedSection(
    content: string,
    related: Array<{ title: string; path: string; score: number; reason: string }>,
  ): string {
    const section = [
      '## 相关笔记',
      '',
      ...(related.length > 0
        ? related.map(
            (item) =>
              `- [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]]（score: ${item.score}，reason: ${item.reason}）`,
          )
        : ['- 暂无相关笔记']),
      '',
    ].join('\n');

    const withoutOld = content.replace(
      /\n## 相关笔记\n[\s\S]*?(?=\n## 正文\n|\n## [^\n]+\n|$)/,
      '\n',
    );
    if (withoutOld.includes('\n## 正文\n')) {
      return withoutOld.replace('\n## 正文\n', `\n${section}\n## 正文\n`);
    }
    return `${withoutOld.trimEnd()}\n\n${section}\n`;
  }

  private async writeEntityCompiledPages(
    entities: Map<string, Array<{ title: string; path: string; summary: string }>>,
  ): Promise<void> {
    const dir = resolve(this.compiledDir(), 'entities');
    await mkdir(dir, { recursive: true });
    const indexLines = ['# Entities Index', ''];
    for (const [entity, list] of [...entities.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const filePath = resolve(dir, `${this.safeFilename(entity)}.md`);
      this.assertInsideVault(filePath);
      indexLines.push(
        `- [[${this.vaultRelative(filePath).replace(/\.md$/, '')}|${entity}]]（${list.length}）`,
      );
      await writeFile(
        filePath,
        [
          '---',
          `title: ${this.yamlString(entity)}`,
          `type: ${this.yamlString('entity')}`,
          `entities: [${this.yamlString(entity)}]`,
          `source_notes: [${list.map((item) => this.yamlString(this.vaultRelative(item.path))).join(', ')}]`,
          `updated_at: ${this.yamlString(new Date().toISOString())}`,
          '---',
          '',
          `# ${entity}`,
          '',
          '## 当前资料',
          '',
          ...list.map(
            (item) =>
              `- [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]]`,
          ),
          '',
          '## 证据摘要',
          '',
          ...list.map((item) =>
            [
              `### [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]]`,
              '',
              item.summary || '- 暂无摘要',
              '',
            ].join('\n'),
          ),
          '## 待确认',
          '',
          '- 该实体的版本、边界、依赖和上下游关系需要在真实项目中继续校验。',
          '- 如果多份资料对该实体给出不同定义、职责或状态，以最新 source note 和真实业务 owner 确认为准。',
          '',
          '## 开放问题',
          '',
          '- 该实体是否有权威 owner、最新版本和废弃版本？',
          '- 该实体与其他实体的上下游关系是否需要写入 GraphRAG？',
          '- 该实体是否涉及权限、合规或跨部门例外规则？',
          '',
        ].join('\n'),
        'utf8',
      );
    }
    await writeFile(
      resolve(this.indexDir(), 'entities.md'),
      `${indexLines.join('\n')}\n`,
      'utf8',
    );
  }

  private async writeConclusionCompiledPages(
    conclusions: Array<{
      title: string;
      path: string;
      conclusion: string;
      risks: string;
      acceptance: string;
      openQuestions: string;
    }>,
  ): Promise<void> {
    const dir = resolve(this.compiledDir(), 'conclusions');
    await mkdir(dir, { recursive: true });
    const indexLines = ['# Conclusions Index', ''];
    const grouped = new Map<string, typeof conclusions>();
    for (const item of conclusions) {
      const key = this.safeFilename(item.conclusion).slice(0, 60) || 'conclusion';
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    }
    for (const [key, list] of grouped) {
      const title = list[0]?.conclusion ?? key;
      const filePath = resolve(dir, `${key}.md`);
      this.assertInsideVault(filePath);
      indexLines.push(
        `- [[${this.vaultRelative(filePath).replace(/\.md$/, '')}|${title}]]（${list.length}）`,
      );
      await writeFile(
        filePath,
        [
          '---',
          `title: ${this.yamlString(title)}`,
          `type: ${this.yamlString('conclusion')}`,
          `source_notes: [${list.map((item) => this.yamlString(this.vaultRelative(item.path))).join(', ')}]`,
          `updated_at: ${this.yamlString(new Date().toISOString())}`,
          '---',
          '',
          `# ${title}`,
          '',
          '## 结论',
          '',
          `- ${title}`,
          '',
          '## 证据',
          '',
          ...list.map(
            (item) =>
              `- [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]]：${item.conclusion}`,
          ),
          '',
          '## 风险',
          '',
          ...this.mergeSectionItems(list.map((item) => item.risks)),
          '',
          '## 验收口径',
          '',
          ...this.mergeSectionItems(list.map((item) => item.acceptance)),
          '',
          '## 版本/矛盾检查',
          '',
          ...this.detectVersionConflicts([
            ...list.map((item) => item.conclusion),
            ...list.map((item) => item.risks),
            ...list.map((item) => item.acceptance),
            ...list.map((item) => item.openQuestions),
          ]),
          '',
          '## 开放问题',
          '',
          ...this.mergeSectionItems(list.map((item) => item.openQuestions)),
          '',
        ].join('\n'),
        'utf8',
      );
    }
    await writeFile(
      resolve(this.indexDir(), 'conclusions.md'),
      `${indexLines.join('\n')}\n`,
      'utf8',
    );
  }

  private async writeGraphSeedIndex(): Promise<void> {
    const seed = await this.exportGraphSeed();
    const dir = resolve(this.indexDir(), 'graph');
    await mkdir(dir, { recursive: true });
    await writeFile(
      resolve(dir, 'obsidian-seed.json'),
      JSON.stringify(seed, null, 2),
      'utf8',
    );
  }

  private async buildProjectWorkflowMarkdown(
    input: ProjectWorkflowInput,
    evidence: string,
  ): Promise<string> {
    const prompt = [
      '你是软件项目决策编排助手。请基于输入和 Obsidian 证据输出 Markdown，不要输出代码围栏。',
      `工作流类型：${this.workflowLabel(input.type)}`,
      '',
      '固定要求：',
      '- 结论先行。',
      '- 明确方案取舍，不要含糊。',
      '- 每个关键判断都要写依据或待确认项。',
      '- 输出要能直接放进 Obsidian 作为项目决策记录。',
      '',
      this.workflowInstruction(input.type),
      '',
      `标题：${input.title}`,
      `问题：${input.question}`,
      input.context ? `背景：${input.context}` : '',
      input.constraints?.length
        ? `约束：\n${input.constraints.map((item) => `- ${item}`).join('\n')}`
        : '',
      input.options?.length
        ? `候选方案：\n${input.options.map((item) => `- ${item}`).join('\n')}`
        : '',
      '',
      'Obsidian 证据：',
      evidence || '无',
    ].join('\n');

    try {
      return (await this.llmProvider.invoke(prompt)).trim();
    } catch (error) {
      this.logger.warn(
        `Project workflow generation failed, fallback to template: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.fallbackProjectWorkflowMarkdown(input);
    }
  }

  private workflowInstruction(type: ProjectWorkflowType): string {
    if (type === 'solution') {
      return [
        '请输出以下小节：',
        '## 推荐方案',
        '## 方案对比',
        '## 取舍理由',
        '## 适用边界',
        '## 风险与缓解',
        '## 待确认问题',
      ].join('\n');
    }
    if (type === 'tech-selection') {
      return [
        '请输出以下小节：',
        '## 最终技术选型',
        '## 候选技术评分',
        '## 关键约束',
        '## 集成影响',
        '## 迁移/替换成本',
        '## 待验证点',
      ].join('\n');
    }
    if (type === 'adr') {
      return [
        '请按 ADR 格式输出以下小节：',
        '## Status',
        '## Context',
        '## Decision',
        '## Alternatives',
        '## Consequences',
        '## Rollback Conditions',
      ].join('\n');
    }
    return [
      '请输出以下小节：',
      '## 模块拆解',
      '## 接口清单',
      '## 数据流',
      '## 里程碑',
      '## 风险清单',
      '## 验收标准',
    ].join('\n');
  }

  private workflowLabel(type: ProjectWorkflowType): string {
    const labels: Record<ProjectWorkflowType, string> = {
      solution: '方案选择',
      'tech-selection': '技术选型',
      adr: '架构决策 ADR',
      'task-breakdown': '任务拆解',
    };
    return labels[type];
  }

  private fallbackProjectWorkflowMarkdown(input: ProjectWorkflowInput): string {
    if (input.type === 'solution') {
      return [
        '## 推荐方案',
        '',
        '- 暂按输入背景生成初稿，需补充证据后复核。',
        '',
        '## 方案对比',
        '',
        ...(input.options?.length
          ? input.options.map((item) => `- ${item}：待补充成本、收益、风险。`)
          : ['- 暂无候选方案。']),
        '',
        '## 取舍理由',
        '',
        '- 优先选择实现成本可控、后续可演进、风险可回滚的方案。',
        '',
        '## 适用边界',
        '',
        '- 适用于当前输入约束内的项目阶段。',
        '',
        '## 风险与缓解',
        '',
        '- 证据不足：补充真实业务样本和运行指标后复核。',
        '',
        '## 待确认问题',
        '',
        '- 目标用户、时间约束、资源约束、验收标准。',
      ].join('\n');
    }
    if (input.type === 'tech-selection') {
      return [
        '## 最终技术选型',
        '',
        '- 暂不硬定，需补充候选技术约束和验证数据。',
        '',
        '## 候选技术评分',
        '',
        ...(input.options?.length
          ? input.options.map((item) => `- ${item}：待评分。`)
          : ['- 暂无候选技术。']),
        '',
        '## 关键约束',
        '',
        ...(input.constraints?.length
          ? input.constraints.map((item) => `- ${item}`)
          : ['- 待补充。']),
        '',
        '## 集成影响',
        '',
        '- 待结合现有模块边界评估。',
        '',
        '## 迁移/替换成本',
        '',
        '- 待补充 PoC 结果。',
        '',
        '## 待验证点',
        '',
        '- 性能、稳定性、维护成本、团队熟悉度。',
      ].join('\n');
    }
    if (input.type === 'adr') {
      return [
        '## Status',
        '',
        'Proposed',
        '',
        '## Context',
        '',
        input.context || input.question,
        '',
        '## Decision',
        '',
        '- 待根据证据敲定。',
        '',
        '## Alternatives',
        '',
        ...(input.options?.length
          ? input.options.map((item) => `- ${item}`)
          : ['- 待补充备选方案。']),
        '',
        '## Consequences',
        '',
        '- 待补充正负影响。',
        '',
        '## Rollback Conditions',
        '',
        '- 关键指标不达标或维护成本超出预期时回滚。',
      ].join('\n');
    }
    return [
      '## 模块拆解',
      '',
      '- 待按业务域和技术边界拆分。',
      '',
      '## 接口清单',
      '',
      '- 待补充。',
      '',
      '## 数据流',
      '',
      '- 待补充。',
      '',
      '## 里程碑',
      '',
      '- M1：最小闭环。',
      '- M2：质量和异常治理。',
      '- M3：管理后台和验收。',
      '',
      '## 风险清单',
      '',
      '- 需求不清、依赖不稳定、数据不足。',
      '',
      '## 验收标准',
      '',
      '- 功能可运行、关键路径可验证、异常可观测。',
    ].join('\n');
  }

  private async refreshProjectWorkflowIndex(): Promise<void> {
    const files = await this.listMarkdownFiles(
      resolve(this.compiledDir(), 'project-workflows'),
      'compiled',
    );
    const lines = ['# Project Workflow Index', ''];
    for (const file of files) {
      const content = await readFile(file.path, 'utf8');
      const frontmatter = this.parseFrontmatter(content);
      const title = String(
        frontmatter.title ||
          this.titleFromMarkdown(content) ||
          basename(file.path, '.md'),
      );
      const type = this.frontmatterString(frontmatter.workflow_type) ?? 'unknown';
      lines.push(
        `- [[${this.vaultRelative(file.path).replace(/\.md$/, '')}|${title}]]（${type}）`,
      );
    }
    await mkdir(this.indexDir(), { recursive: true });
    await writeFile(
      resolve(this.indexDir(), 'project-workflows.md'),
      `${lines.join('\n')}\n`,
      'utf8',
    );
  }

  private async readAllNotes(): Promise<Array<{ path: string; content: string }>> {
    const files = await this.listMarkdownFiles(this.notesDir(), 'note');
    const notes: Array<{ path: string; content: string }> = [];
    for (const file of files) {
      notes.push({ path: file.path, content: await readFile(file.path, 'utf8') });
    }
    return notes;
  }

  private async findNoteByHash(contentHash: string): Promise<string | null> {
    for (const file of await this.listMarkdownFiles(this.notesDir(), 'note')) {
      try {
        const content = await readFile(file.path, 'utf8');
        if (content.includes(`content_hash: "${contentHash}"`)) {
          return file.path;
        }
      } catch {
        // ignore unreadable note
      }
    }
    return null;
  }

  private async listMarkdownFiles(
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

  private parseFrontmatter(content: string): Record<string, unknown> {
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

  private normalizeDraft(value: unknown): ObsidianNoteDraft {
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
      keyPoints: keyPoints.length > 0 ? keyPoints : ['正文已保留，可回到原文继续分析。'],
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

  private heuristicDraft(content: string, title: string): ObsidianNoteDraft {
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
      keyPoints: headings.length > 0 ? headings : ['正文已保留，可回到原文继续分析。'],
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

  private inferTags(text: string): string[] {
    const candidates: Array<[RegExp, string]> = [
      [/AI|人工智能|大模型|LLM/i, 'AI'],
      [/产品|MVP|需求|用户|体验/i, '产品'],
      [/架构|系统|链路|数据流/i, '架构'],
      [/技术|框架|工程|代码|开发/i, '技术'],
      [/React/i, 'React'],
      [/Vue/i, 'Vue'],
      [/NestJS/i, 'NestJS'],
      [/JavaScript|TypeScript|JS/i, 'JavaScript'],
      [/知识库|Obsidian|Karpathy|RAG/i, '知识库'],
      [/写作|选题|内容|文章/i, '写作'],
    ];
    return candidates
      .filter(([pattern]) => pattern.test(text))
      .map(([, tag]) => tag)
      .slice(0, 5);
  }

  private inferTopics(text: string): string[] {
    return this.inferTags(text).slice(0, 5);
  }

  private inferEntities(text: string): string[] {
    const english =
      text.match(/\b[A-Z][A-Za-z0-9]*(?:[.-]?[A-Z][A-Za-z0-9]*)*\b/g) ?? [];
    const chinese =
      text.match(/(?:React|Vue|NestJS|TypeScript|JavaScript|Milvus|Neo4j|Redis|PostgreSQL|Elasticsearch|Obsidian|Karpathy|RAG|GraphRAG|Agentic|LangChain|OpenAI|DeepSeek|Qwen|Docker|Node\.js)/gi) ??
      [];
    return [...new Set([...english, ...chinese])]
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
      .slice(0, 8);
  }

  private sectionList(content: string, heading: string): string[] {
    return this.extractSection(content, heading)
      .split('\n')
      .map((line) => line.replace(/^[-*\s]+/, '').trim())
      .filter((line) => line.length > 0 && line !== '暂无明确内容')
      .slice(0, 20);
  }

  private mergeSectionItems(sections: string[]): string[] {
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
    return items.length > 0 ? items.map((item) => `- ${item}`) : ['- 暂无明确内容'];
  }

  private detectVersionConflicts(lines: string[]): string[] {
    const normalizedLines = lines
      .flatMap((line) => line.split('\n'))
      .map((line) => line.trim())
      .filter(Boolean);
    const years = new Set(
      normalizedLines.flatMap((line) => line.match(/20\d{2}/g) ?? []),
    );
    const conflictSignals: string[] = [];
    const pairs: Array<[RegExp, RegExp, string]> = [
      [/推荐|建议|应该|必须|采用|允许|可以/, /不推荐|不建议|不应该|禁止|避免|不可|不能/, '同一结论附近同时出现正反决策词'],
      [/生效|最新|优先|当前/, /历史|废弃|过期|失效|旧版/, '同一结论附近同时出现新旧版本词'],
      [/必须|强制|required/i, /可选|非必须|optional/i, '同一结论附近同时出现强制和可选词'],
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

  private addGraphNode(
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

  private addGraphRelationship(
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

  private extractLinesByKeywords(content: string, keywords: string[]): string[] {
    return content
      .split(/\n+|(?<=[。！？!?；;])/u)
      .map((line) => line.replace(/^[-#*\s]+/, '').trim())
      .filter((line) =>
        keywords.some((keyword) => line.toLowerCase().includes(keyword)),
      )
      .filter((line) => line.length >= 4)
      .slice(0, 5);
  }

  private listOrEmpty(items: string[]): string[] {
    return items.length > 0
      ? items.map((item) => `- ${item}`)
      : ['- 暂无明确内容'];
  }

  private extractSection(content: string, heading: string): string {
    const pattern = new RegExp(
      `^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`,
      'm',
    );
    return pattern.exec(content)?.[1]?.trim() ?? '';
  }

  private scoreText(tokens: Set<string>, text: string): number {
    if (tokens.size === 0) return 0;
    const normalized = text.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (normalized.includes(token.toLowerCase())) score += 1;
    }
    return score;
  }

  private snippet(content: string, tokens: Set<string>): string {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const matched = lines.filter((line) => this.scoreText(tokens, line) > 0);
    return (matched.length > 0 ? matched : lines).slice(0, 8).join('\n').slice(0, 1600);
  }

  private extractTokens(text: string): Set<string> {
    const normalized = text.normalize('NFKC').toLowerCase();
    const words = normalized.match(/[a-z0-9][a-z0-9._-]{1,}|[\u4e00-\u9fa5]{2,}/gi) ?? [];
    const stop = new Set(['什么', '怎么', '如何', '一下', '这个', '那个', '哪些', '是否']);
    return new Set(words.map((word) => word.trim()).filter((word) => word.length >= 2 && !stop.has(word)));
  }

  private cleanStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : [];
  }

  private extractJson(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM response does not contain JSON');
    return match[0];
  }

  private titleFromMarkdown(content: string): string | null {
    return /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? null;
  }

  private frontmatterString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  private frontmatterTags(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }

  private async ensureVault(): Promise<void> {
    await mkdir(this.rawDir(), { recursive: true });
    await mkdir(this.notesDir(), { recursive: true });
    await mkdir(this.compiledDir(), { recursive: true });
    await mkdir(this.indexDir(), { recursive: true });
  }

  private async nextAvailablePath(filePath: string): Promise<string> {
    let candidate = filePath;
    let index = 2;
    while (await this.exists(candidate)) {
      candidate = filePath.replace(/\.md$/, `-${index}.md`);
      index += 1;
    }
    return candidate;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeTitle(title: string): string {
    return title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  }

  private safeFilename(title: string): string {
    return (
      this.normalizeTitle(title)
        .replace(/[\\/:*?"<>|#\[\]\n\r\t]+/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'untitled'
    );
  }

  private hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
    }).format(new Date());
  }

  private yamlString(value: string): string {
    return JSON.stringify(value);
  }

  private vaultRelative(filePath: string): string {
    return relative(this.vaultDir(), filePath).replace(/\\/g, '/');
  }

  private rawDir(): string {
    return resolve(this.vaultDir(), 'raw');
  }

  private notesDir(): string {
    return resolve(this.vaultDir(), 'notes');
  }

  private compiledDir(): string {
    return resolve(this.vaultDir(), 'compiled');
  }

  private indexDir(): string {
    return resolve(this.vaultDir(), 'index');
  }

  private vaultDir(): string {
    return resolve(
      this.config.get<string>('obsidian.vaultDir') ??
        resolve(process.cwd(), '../workspace/obsidian'),
    );
  }

  private assertInsideVault(target: string): void {
    const root = this.vaultDir();
    const rel = relative(root, target);
    if (rel.startsWith('..') || rel === '' || resolve(root, rel) !== target) {
      throw new Error(`unsafe Obsidian path: ${target}`);
    }
  }
}
