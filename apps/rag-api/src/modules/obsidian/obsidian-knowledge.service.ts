import type {
  ObsidianAccessContext,
  ObsidianGraphSeed,
  ObsidianNoteDraft,
  ObsidianSearchHit,
  ObsidianSourceInput,
  ObsidianSourceLookup,
  ObsidianWriteResult,
  ProjectWorkflowInput,
  ProjectWorkflowResult,
  ProjectWorkflowType,
} from './obsidian-knowledge.types';
export type {
  ObsidianAccessContext,
  ObsidianGraphSeed,
  ObsidianNoteDraft,
  ObsidianSearchHit,
  ObsidianSourceInput,
  ObsidianSourceLookup,
  ObsidianWriteResult,
  ProjectWorkflowInput,
  ProjectWorkflowResult,
  ProjectWorkflowType,
} from './obsidian-knowledge.types';
import { ObsidianCompiledIndexSupport } from './obsidian-knowledge.index-support';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { LangfuseProvider } from '../../providers/observability/langfuse.provider';
import {
  obsidianNoteDraftPromptDefinition,
  obsidianProjectWorkflowPromptDefinition,
} from './obsidian-knowledge.prompts';
import { getPromptVersion } from '../../rag/prompts/prompt-registry';

@Injectable()
export class ObsidianKnowledgeService extends ObsidianCompiledIndexSupport {
  private readonly logger = new Logger(ObsidianKnowledgeService.name);

  constructor(
    protected readonly config: ConfigService,
    private readonly llmProvider: LlmProvider,
    @Optional() private readonly langfuseProvider?: LangfuseProvider,
  ) {
    super();
  }

  async writeSource(input: ObsidianSourceInput): Promise<ObsidianWriteResult> {
    this.assertAccessContext({ userId: input.userId });
    const content = input.content.trim();
    if (
      input.contentHash !== undefined &&
      !/^[a-f0-9]{64}$/i.test(input.contentHash)
    ) {
      throw new Error('contentHash must be a 64-character SHA-256 hex string');
    }
    const contentHash = input.contentHash?.toLowerCase() ?? this.hash(content);
    const title = this.normalizeTitle(input.title);

    try {
      await this.ensureVault();
      const duplicate = await this.findNoteByHash(contentHash, {
        userId: input.userId,
      });
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

      const draft = await this.buildDraft(content, title, input.userId);
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

  async search(
    query: string,
    limit = 5,
    access: ObsidianAccessContext,
  ): Promise<ObsidianSearchHit[]> {
    this.assertAccessContext(access);
    await this.ensureVault();
    // 旧版 compiled/index 文件可能混入受限笔记，无法可靠还原来源 ACL；只检索逐篇校验的源笔记。
    const files = await this.listMarkdownFiles(this.notesDir(), 'note');
    const tokens = this.extractTokens(query);
    // 文件内容彼此独立，按固定小批次并发读取，避免大知识库一次打开过多文件。
    const readConcurrency = 8;
    const batches = Array.from(
      { length: Math.ceil(files.length / readConcurrency) },
      (_, index) =>
        files.slice(index * readConcurrency, (index + 1) * readConcurrency),
    );
    const hits: ObsidianSearchHit[] = [];
    for (const batch of batches) {
      const batchHits = await Promise.all(
        batch.map(async (file): Promise<ObsidianSearchHit | null> => {
          const content = await readFile(file.path, 'utf8');
          const frontmatter = this.parseFrontmatter(content);
          if (!this.canReadFrontmatter(frontmatter, access)) return null;
          const body = content.replace(/^---[\s\S]*?---\s*/m, '').trim();
          const score = this.scoreText(
            tokens,
            `${this.frontmatterString(frontmatter.title) ?? ''}\n${body}`,
          );
          if (score <= 0) return null;
          return {
            path: file.path,
            type: file.type,
            title:
              this.frontmatterString(frontmatter.title) ??
              this.titleFromMarkdown(body) ??
              basename(file.path, '.md'),
            content: this.snippet(body, tokens),
            ...(this.frontmatterString(frontmatter.type) === 'source_note'
              ? { isSourceNote: true }
              : {}),
            score:
              file.type === 'compiled'
                ? score + 3
                : file.type === 'index'
                  ? score + 1
                  : score,
            ragDocId: this.frontmatterString(frontmatter.rag_doc_id),
            sourceUrl: this.frontmatterString(frontmatter.source_url),
            tags: this.frontmatterTags(frontmatter.tags),
          };
        }),
      );
      hits.push(
        ...batchHits.filter((hit): hit is ObsidianSearchHit => Boolean(hit)),
      );
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async findNoteByRagDocId(
    docId: string,
    access: ObsidianAccessContext,
  ): Promise<string | null> {
    this.assertAccessContext(access);
    if (!docId.trim()) return null;
    for (const file of await this.listMarkdownFiles(this.notesDir(), 'note')) {
      try {
        const content = await readFile(file.path, 'utf8');
        if (
          content.includes(`rag_doc_id: "${docId}"`) &&
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

  async findSourceByContentHash(
    contentOrHash: string,
    access: ObsidianAccessContext,
  ): Promise<ObsidianSourceLookup | null> {
    this.assertAccessContext(access);
    const contentHash = /^[a-f0-9]{64}$/i.test(contentOrHash.trim())
      ? contentOrHash.trim()
      : this.hash(contentOrHash.trim());
    const notePath = await this.findNoteByHash(contentHash, access);
    if (!notePath) return null;
    const content = await readFile(notePath, 'utf8');
    const frontmatter = this.parseFrontmatter(content);
    return {
      notePath,
      ragDocId: this.frontmatterString(frontmatter.rag_doc_id),
      title:
        this.frontmatterString(frontmatter.title) ??
        this.titleFromMarkdown(content) ??
        basename(notePath, '.md'),
      tags: this.frontmatterTags(frontmatter.tags),
      contentHash,
    };
  }

  async exportGraphSeed(
    access: ObsidianAccessContext,
  ): Promise<ObsidianGraphSeed> {
    this.assertAccessContext(access);
    const notes = (await this.readAllNotes()).filter((note) =>
      this.canReadFrontmatter(this.parseFrontmatter(note.content), access),
    );
    return this.buildGraphSeed(notes);
  }

  async generateProjectWorkflow(
    input: ProjectWorkflowInput,
    access: ObsidianAccessContext,
  ): Promise<ProjectWorkflowResult> {
    this.assertAccessContext(access);
    await this.ensureVault();
    const title = this.normalizeTitle(input.title || input.question);
    const query = [
      input.question,
      input.context ?? '',
      ...(input.options ?? []),
    ]
      .join('\n')
      .trim();
    const hits = await this.search(query, 8, access);
    const evidence = this.formatHitsForPrompt(hits);
    const body = await this.buildProjectWorkflowMarkdown(
      input,
      evidence,
      access.userId,
    );
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
      `allowed_users: [${this.yamlString(access.userId)}]`,
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

  assessHits(
    query: string,
    hits: ObsidianSearchHit[],
  ): {
    sufficient: boolean;
    reason: string;
  } {
    if (hits.length === 0) {
      return { sufficient: false, reason: 'Obsidian 未命中长期知识' };
    }
    const tokens = this.extractTokens(query);
    const best = Math.max(
      ...hits.map((hit) => this.scoreText(tokens, hit.content)),
    );
    if (best < 2 && tokens.size >= 2) {
      return {
        sufficient: false,
        reason: `Obsidian 命中弱，最高关键词覆盖 ${best}`,
      };
    }
    return {
      sufficient: true,
      reason: 'Obsidian source note 命中',
    };
  }

  private async buildDraft(
    content: string,
    title: string,
    userId?: string,
  ): Promise<ObsidianNoteDraft> {
    const startedAt = Date.now();
    const promptVersion = getPromptVersion('obsidian.note_draft');
    try {
      const response = await this.llmProvider.invoke(
        [
          {
            role: 'system',
            content: obsidianNoteDraftPromptDefinition.system,
          },
          {
            role: 'user',
            content: [
              ...obsidianNoteDraftPromptDefinition.instructions,
              '',
              `${obsidianNoteDraftPromptDefinition.inputLabels.title}${title}`,
              '',
              obsidianNoteDraftPromptDefinition.inputLabels.content,
              content.slice(0, obsidianNoteDraftPromptDefinition.contentLimit),
            ].join('\n'),
          },
        ],
        {
          metadata: {
            promptVersion,
          },
        },
      );
      const draft = this.normalizeDraft(JSON.parse(this.extractJson(response)));
      this.langfuseProvider?.tracePromptOperation({
        name: 'rag.obsidian.note_draft',
        userId,
        promptVersions: { 'obsidian.note_draft': promptVersion },
        status: 'success',
        latencyMs: Date.now() - startedAt,
        inputSummary: { contentChars: content.length },
        outputSummary: {
          summaryCount: draft.summary.length,
          keyPointCount: draft.keyPoints.length,
          tagCount: draft.tags.length,
          topicCount: draft.topics.length,
        },
      });
      return draft;
    } catch (error) {
      this.langfuseProvider?.tracePromptOperation({
        name: 'rag.obsidian.note_draft',
        userId,
        promptVersions: { 'obsidian.note_draft': promptVersion },
        status: 'fallback',
        latencyMs: Date.now() - startedAt,
        inputSummary: { contentChars: content.length },
        outputSummary: {
          fallback: true,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
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

  private async writeNote(
    params: ObsidianSourceInput & {
      date: string;
      contentHash: string;
      draft: ObsidianNoteDraft;
      rawPath: string;
    },
  ): Promise<string> {
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
      params.sourceUrl
        ? `source_url: ${this.yamlString(params.sourceUrl)}`
        : null,
      `tags: [${params.draft.tags.map((tag) => this.yamlString(tag)).join(', ')}]`,
      `topics: [${params.draft.topics.map((item) => this.yamlString(item)).join(', ')}]`,
      `entities: [${params.draft.entities.map((item) => this.yamlString(item)).join(', ')}]`,
      `date: ${this.yamlString(params.date)}`,
      `allowed_users: [${this.yamlString(params.userId)}]`,
      params.ragDocId
        ? `rag_doc_id: ${this.yamlString(params.ragDocId)}`
        : null,
      `content_hash: ${this.yamlString(params.contentHash)}`,
      `source_type: ${this.yamlString(params.sourceType)}`,
      params.contentType
        ? `content_type: ${this.yamlString(params.contentType)}`
        : null,
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

  private async buildProjectWorkflowMarkdown(
    input: ProjectWorkflowInput,
    evidence: string,
    userId?: string,
  ): Promise<string> {
    const startedAt = Date.now();
    const promptVersion = getPromptVersion('obsidian.project_workflow');
    const prompt = [
      obsidianProjectWorkflowPromptDefinition.system,
      `${obsidianProjectWorkflowPromptDefinition.labels.workflowType}${this.workflowLabel(input.type)}`,
      '',
      obsidianProjectWorkflowPromptDefinition.labels.commonRequirements,
      ...obsidianProjectWorkflowPromptDefinition.commonRequirements.map(
        (requirement) =>
          `${obsidianProjectWorkflowPromptDefinition.labels.bullet} ${requirement}`,
      ),
      '',
      this.workflowInstruction(input.type),
      '',
      `${obsidianProjectWorkflowPromptDefinition.labels.title}${input.title}`,
      `${obsidianProjectWorkflowPromptDefinition.labels.question}${input.question}`,
      input.context
        ? `${obsidianProjectWorkflowPromptDefinition.labels.context}${input.context}`
        : '',
      input.constraints?.length
        ? `${obsidianProjectWorkflowPromptDefinition.labels.constraints}\n${input.constraints.map((item) => `${obsidianProjectWorkflowPromptDefinition.labels.bullet} ${item}`).join('\n')}`
        : '',
      input.options?.length
        ? `${obsidianProjectWorkflowPromptDefinition.labels.options}\n${input.options.map((item) => `${obsidianProjectWorkflowPromptDefinition.labels.bullet} ${item}`).join('\n')}`
        : '',
      '',
      obsidianProjectWorkflowPromptDefinition.labels.evidence,
      evidence || obsidianProjectWorkflowPromptDefinition.labels.emptyEvidence,
    ].join('\n');

    try {
      const markdown = (
        await this.llmProvider.invoke(prompt, {
          metadata: { promptVersion },
        })
      ).trim();
      this.langfuseProvider?.tracePromptOperation({
        name: 'rag.obsidian.project_workflow',
        userId,
        promptVersions: { 'obsidian.project_workflow': promptVersion },
        status: 'success',
        latencyMs: Date.now() - startedAt,
        inputSummary: {
          workflowType: input.type,
          questionChars: input.question.length,
          evidenceChars: evidence.length,
        },
        outputSummary: { markdownChars: markdown.length },
      });
      return markdown;
    } catch (error) {
      this.langfuseProvider?.tracePromptOperation({
        name: 'rag.obsidian.project_workflow',
        userId,
        promptVersions: { 'obsidian.project_workflow': promptVersion },
        status: 'fallback',
        latencyMs: Date.now() - startedAt,
        inputSummary: {
          workflowType: input.type,
          questionChars: input.question.length,
          evidenceChars: evidence.length,
        },
        outputSummary: {
          fallback: true,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
      this.logger.warn(
        `Project workflow generation failed, fallback to template: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.fallbackProjectWorkflowMarkdown(input);
    }
  }

  private workflowInstruction(type: ProjectWorkflowType): string {
    return obsidianProjectWorkflowPromptDefinition.workflowInstructions[
      type
    ].join('\n');
  }

  private workflowLabel(type: ProjectWorkflowType): string {
    return obsidianProjectWorkflowPromptDefinition.workflowLabels[type];
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
      if (!this.isPublicFrontmatter(frontmatter)) continue;
      const title =
        this.frontmatterString(frontmatter.title) ??
        this.titleFromMarkdown(content) ??
        basename(file.path, '.md');
      const type =
        this.frontmatterString(frontmatter.workflow_type) ?? 'unknown';
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
}
