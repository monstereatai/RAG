import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SkillsService } from './skills.service';

jest.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: jest.fn().mockImplementation(() => ({
    embedQuery: jest.fn().mockResolvedValue([1, 0]),
    embedDocuments: jest.fn().mockResolvedValue([
      [0.9, 0.1],
      [0.1, 0.9],
    ]),
  })),
}));

describe('SkillsService', () => {
  let rootDir: string;
  let service: SkillsService;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-skills-'));
    service = new SkillsService({
      get: (key: string) => (key === 'skills.rootDir' ? rootDir : undefined),
    } as ConfigService);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('returns an empty list when no SKILL.md files exist', async () => {
    await expect(service.list()).resolves.toEqual([]);
  });

  it('loads SKILL.md metadata from nested directories', async () => {
    await writeSkill(
      'writing',
      [
        '---',
        'name: "writing-assistant"',
        'description: "Draft and polish Chinese articles"',
        'tags: ["writing", "article"]',
        '---',
        '# Writing',
        'Use this skill for article outlines.',
      ].join('\n'),
    );

    const skills = await service.list();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'writing-assistant',
      description: 'Draft and polish Chinese articles',
      tags: ['writing', 'article'],
    });
    expect(skills[0].sourcePath).toBe(
      path.join(rootDir, 'writing', 'SKILL.md'),
    );
  });

  it('matches skills by English and Chinese query terms', async () => {
    await writeSkill(
      'rag',
      [
        '---',
        'name: rag-helper',
        'description: RAG 检索和知识库问答',
        'tags: ["rag", "retrieval"]',
        '---',
        'Use for Milvus retrieval and answer generation.',
      ].join('\n'),
    );
    await writeSkill(
      'speech',
      [
        '---',
        'name: speech-helper',
        'description: 腾讯云语音合成和识别',
        'tags: ["speech"]',
        '---',
        'Use for ASR and TTS.',
      ].join('\n'),
    );

    const matches = await service.match('知识库 retrieval', 2);

    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('rag-helper');
    expect(matches[0].matchMode).toBe('token');
    expect(matches[0].score).toBeGreaterThan(0);
    expect(matches[0].matchedTerms).toEqual(
      expect.arrayContaining(['retrieval']),
    );
  });

  it('uses embeddings for semantic ranking when an embedding key is configured', async () => {
    service = new SkillsService({
      get: (key: string) => {
        if (key === 'skills.rootDir') return rootDir;
        if (key === 'embedding.qwen.apiKey') return 'test-key';
        if (key === 'embedding.qwen.model') return 'text-embedding-v3';
        if (key === 'embedding.qwen.baseUrl') return 'https://example.test/v1';
        if (key === 'embedding.qwen.dimension') return 2;
        return undefined;
      },
    } as ConfigService);
    await writeSkill(
      'writing',
      [
        '---',
        'name: writing-helper',
        'description: 写文章和内容润色',
        '---',
        'Use for article drafts.',
      ].join('\n'),
    );
    await writeSkill(
      'rag',
      [
        '---',
        'name: rag-helper',
        'description: 检索增强生成',
        '---',
        'Use for retrieval augmented generation.',
      ].join('\n'),
    );

    const matches = await service.match('semantic query', 2);

    expect(matches.map((match) => match.name)).toEqual([
      'rag-helper',
      'writing-helper',
    ]);
    expect(matches[0].matchMode).toBe('embedding');
    expect(matches[0].semanticScore).toBeGreaterThan(matches[1].semanticScore!);
  });

  async function writeSkill(dirName: string, content: string) {
    const skillDir = path.join(rootDir, dirName);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  }
});
