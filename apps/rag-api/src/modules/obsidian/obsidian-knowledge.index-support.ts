import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { ObsidianKnowledgeFileSupport } from './obsidian-knowledge.file-support';

export abstract class ObsidianCompiledIndexSupport extends ObsidianKnowledgeFileSupport {
  protected refreshIndexesInFlight?: Promise<void>;

  protected refreshIndexesPending = false;

  protected async refreshIndexes(): Promise<void> {
    if (this.refreshIndexesInFlight) {
      // 新笔记可能在当前刷新读取快照之后才落盘；标记补刷，避免漏索引。
      this.refreshIndexesPending = true;
      return this.refreshIndexesInFlight;
    }

    const refresh = (async () => {
      do {
        this.refreshIndexesPending = false;
        await this.refreshIndexesOnce();
      } while (this.refreshIndexesPending);
    })();
    this.refreshIndexesInFlight = refresh;

    try {
      await refresh;
    } finally {
      this.refreshIndexesInFlight = undefined;
    }
  }

  protected async refreshIndexesOnce(): Promise<void> {
    const notes = (await this.readAllNotes()).filter((note) =>
      this.isPublicFrontmatter(this.parseFrontmatter(note.content)),
    );
    await Promise.all([
      mkdir(this.indexDir(), { recursive: true }),
      mkdir(this.compiledDir(), { recursive: true }),
    ]);

    const tags = new Map<
      string,
      Array<{ title: string; path: string; summary: string }>
    >();
    const entities = new Map<
      string,
      Array<{ title: string; path: string; summary: string }>
    >();
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
      const title =
        this.frontmatterString(frontmatter.title) ??
        this.titleFromMarkdown(note.content) ??
        basename(note.path, '.md');
      const summary = this.extractSection(note.content, '摘要')
        .split('\n')
        .slice(0, 4)
        .join('\n');
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
      sources.push(
        `- [[${this.vaultRelative(note.path).replace(/\.md$/, '')}|${title}]]`,
      );
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

    await Promise.all([
      writeFile(
        resolve(this.indexDir(), 'sources.md'),
        ['# Sources Index', '', ...sources.sort(), ''].join('\n'),
        'utf8',
      ),
      writeFile(
        resolve(this.indexDir(), 'tags.md'),
        [
          '# Tags Index',
          '',
          ...[...tags.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
              ([tag, list]) =>
                `## ${tag}\n\n${list.map((item) => `- [[${this.vaultRelative(item.path).replace(/\.md$/, '')}|${item.title}]]`).join('\n')}`,
            )
            .flatMap((block) => [block, '']),
        ].join('\n'),
        'utf8',
      ),
    ]);

    await Promise.all([
      this.writeTagCompiledPages(tags),
      this.writeEntityCompiledPages(entities),
      this.writeConclusionCompiledPages(conclusions),
      this.writeGraphSeedIndex(),
    ]);

    await this.refreshRelated(noteRecords);
  }

  protected async writeTagCompiledPages(
    tags: Map<string, Array<{ title: string; path: string; summary: string }>>,
  ): Promise<void> {
    await this.runInBatches([...tags.entries()], 8, async ([tag, list]) => {
      const filePath = resolve(
        this.compiledDir(),
        `${this.safeFilename(tag)}.md`,
      );
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
    });
  }

  protected async runInBatches<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    for (let index = 0; index < items.length; index += concurrency) {
      await Promise.all(items.slice(index, index + concurrency).map(worker));
    }
  }

  protected async refreshRelated(
    notes: Array<{
      title: string;
      path: string;
      tags: string[];
      topics: string[];
      entities: string[];
      content: string;
    }>,
  ): Promise<void> {
    const logLines = [
      '# Related Update Log',
      '',
      `updatedAt: ${new Date().toISOString()}`,
      '',
    ];

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
            sharedEntities.length
              ? `共享实体：${sharedEntities.join('、')}`
              : '',
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

  protected upsertRelatedSection(
    content: string,
    related: Array<{
      title: string;
      path: string;
      score: number;
      reason: string;
    }>,
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

  protected async writeEntityCompiledPages(
    entities: Map<
      string,
      Array<{ title: string; path: string; summary: string }>
    >,
  ): Promise<void> {
    const dir = resolve(this.compiledDir(), 'entities');
    await mkdir(dir, { recursive: true });
    const indexLines = ['# Entities Index', ''];
    const pages = [...entities.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entity, list]) => {
        const filePath = resolve(dir, `${this.safeFilename(entity)}.md`);
        this.assertInsideVault(filePath);
        return { entity, list, filePath };
      });

    for (const { entity, list, filePath } of pages) {
      indexLines.push(
        `- [[${this.vaultRelative(filePath).replace(/\.md$/, '')}|${entity}]]（${list.length}）`,
      );
    }

    await this.runInBatches(pages, 8, async ({ entity, list, filePath }) => {
      this.assertInsideVault(filePath);
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
    });
    await writeFile(
      resolve(this.indexDir(), 'entities.md'),
      `${indexLines.join('\n')}\n`,
      'utf8',
    );
  }

  protected async writeConclusionCompiledPages(
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
      const key =
        this.safeFilename(item.conclusion).slice(0, 60) || 'conclusion';
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    }
    const pages = [...grouped.entries()].map(([key, list]) => {
      const title = list[0]?.conclusion ?? key;
      const filePath = resolve(dir, `${key}.md`);
      this.assertInsideVault(filePath);
      return { title, list, filePath };
    });

    for (const { title, list, filePath } of pages) {
      indexLines.push(
        `- [[${this.vaultRelative(filePath).replace(/\.md$/, '')}|${title}]]（${list.length}）`,
      );
    }

    await this.runInBatches(pages, 8, async ({ title, list, filePath }) => {
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
    });
    await writeFile(
      resolve(this.indexDir(), 'conclusions.md'),
      `${indexLines.join('\n')}\n`,
      'utf8',
    );
  }

  protected async writeGraphSeedIndex(): Promise<void> {
    const publicNotes = (await this.readAllNotes()).filter((note) =>
      this.isPublicFrontmatter(this.parseFrontmatter(note.content)),
    );
    const seed = this.buildGraphSeed(publicNotes);
    const dir = resolve(this.indexDir(), 'graph');
    await mkdir(dir, { recursive: true });
    await writeFile(
      resolve(dir, 'obsidian-seed.json'),
      JSON.stringify(seed, null, 2),
      'utf8',
    );
  }
}
