import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SkillMatch, SkillMetadata } from './skill.types';

interface ParsedSkillFile {
  metadata: Record<string, string>;
  content: string;
}

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);
  private readonly rootDir: string;
  private readonly embeddings: OpenAIEmbeddings | null;

  constructor(private readonly config: ConfigService) {
    this.rootDir =
      config.get<string>('skills.rootDir') ??
      path.resolve(process.cwd(), '../skills');
    this.embeddings = this.createEmbeddings();
  }

  async list(): Promise<SkillMetadata[]> {
    const skillFiles = await this.findSkillFiles(this.rootDir);
    const skills = await Promise.all(
      skillFiles.map((filePath) => this.readSkill(filePath)),
    );

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async match(query: string, limit = 5): Promise<SkillMatch[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const skills = await this.list();
    if (skills.length === 0) {
      return [];
    }

    const tokenMatches = this.matchByToken(normalizedQuery, skills, limit);
    if (!this.embeddings) {
      return tokenMatches;
    }

    try {
      return await this.matchByEmbedding(
        normalizedQuery,
        skills,
        tokenMatches,
        limit,
      );
    } catch (err) {
      this.logger.warn(
        `Skills embedding match failed, fallback to token match: ${(err as Error).message}`,
      );
      return tokenMatches;
    }
  }

  private createEmbeddings(): OpenAIEmbeddings | null {
    const apiKey = this.config.get<string>('embedding.qwen.apiKey');
    if (!apiKey) {
      return null;
    }

    return new OpenAIEmbeddings({
      apiKey,
      model: this.config.get<string>('embedding.qwen.model'),
      configuration: {
        baseURL: this.config.get<string>('embedding.qwen.baseUrl'),
      },
      dimensions: this.config.get<number>('embedding.qwen.dimension') ?? 1024,
    });
  }

  private matchByToken(
    query: string,
    skills: SkillMetadata[],
    limit: number,
  ): SkillMatch[] {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) {
      return [];
    }

    return skills
      .map((skill) => this.scoreSkill(skill, queryTerms))
      .filter((skill) => skill.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  private async matchByEmbedding(
    query: string,
    skills: SkillMetadata[],
    tokenMatches: SkillMatch[],
    limit: number,
  ): Promise<SkillMatch[]> {
    if (!this.embeddings) {
      return tokenMatches;
    }

    const tokenScoreByName = new Map(
      tokenMatches.map((match) => [match.name, match]),
    );
    const [queryVector, skillVectors] = await Promise.all([
      this.embeddings.embedQuery(query),
      this.embeddings.embedDocuments(
        skills.map((skill) => this.skillSearchText(skill)),
      ),
    ]);

    return skills
      .map((skill, index): SkillMatch => {
        const tokenMatch = tokenScoreByName.get(skill.name);
        const semanticScore = this.cosineSimilarity(
          queryVector,
          skillVectors[index],
        );
        return {
          ...skill,
          score: semanticScore * 10 + (tokenMatch?.score ?? 0),
          matchedTerms: tokenMatch?.matchedTerms ?? [],
          matchMode: 'embedding',
          semanticScore,
        };
      })
      .filter((skill) => skill.semanticScore !== undefined)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  private async findSkillFiles(rootDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(rootDir, { withFileTypes: true });
      const nestedFiles = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(rootDir, entry.name);
          if (entry.isDirectory()) {
            return this.findSkillFiles(fullPath);
          }
          return entry.isFile() && entry.name === 'SKILL.md' ? [fullPath] : [];
        }),
      );

      return nestedFiles.flat();
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn(`Skills root not found: ${rootDir}`);
        return [];
      }
      throw err;
    }
  }

  private async readSkill(filePath: string): Promise<SkillMetadata> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = this.parseSkillFile(raw);
    const fallbackName = path.basename(path.dirname(filePath));
    const tags = this.parseTags(parsed.metadata.tags);

    return {
      name: parsed.metadata.name || fallbackName,
      description: parsed.metadata.description || '',
      sourcePath: filePath,
      tags,
      content: parsed.content.trim(),
    };
  }

  private parseSkillFile(raw: string): ParsedSkillFile {
    if (!raw.startsWith('---')) {
      return { metadata: {}, content: raw };
    }

    const endIndex = raw.indexOf('\n---', 3);
    if (endIndex === -1) {
      return { metadata: {}, content: raw };
    }

    const frontmatter = raw.slice(3, endIndex).trim();
    const content = raw.slice(endIndex + 4).trimStart();
    const metadata: Record<string, string> = {};

    for (const line of frontmatter.split('\n')) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) continue;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      metadata[key] = value.replace(/^["']|["']$/g, '');
    }

    return { metadata, content };
  }

  private parseTags(rawTags?: string): string[] {
    if (!rawTags) {
      return [];
    }

    return rawTags
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  private scoreSkill(skill: SkillMetadata, queryTerms: string[]): SkillMatch {
    const haystack = [
      skill.name,
      skill.description,
      skill.tags.join(' '),
      skill.content,
    ]
      .join(' ')
      .toLowerCase();

    const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
    const exactNameBonus = haystack.includes(queryTerms.join(' ')) ? 3 : 0;
    const score = matchedTerms.length + exactNameBonus;

    return {
      ...skill,
      score,
      matchedTerms,
      matchMode: 'token',
    };
  }

  private skillSearchText(skill: SkillMetadata): string {
    return [
      skill.name,
      skill.description,
      skill.tags.join(' '),
      skill.content.slice(0, 2000),
    ].join('\n');
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < a.length; index += 1) {
      dot += a[index] * b[index];
      normA += a[index] * a[index];
      normB += b[index] * b[index];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private tokenize(text: string): string[] {
    const normalized = text.toLowerCase();
    const latinTerms = normalized.match(/[a-z0-9_/-]+/g) ?? [];
    const cjkTerms = normalized.match(/[\u4e00-\u9fff]{1,}/g) ?? [];
    const cjkBigrams = cjkTerms.flatMap((term) => {
      if (term.length <= 2) return [term];
      const bigrams: string[] = [];
      for (let index = 0; index < term.length - 1; index += 1) {
        bigrams.push(term.slice(index, index + 2));
      }
      return bigrams;
    });

    return [...new Set([...latinTerms, ...cjkTerms, ...cjkBigrams])];
  }
}
