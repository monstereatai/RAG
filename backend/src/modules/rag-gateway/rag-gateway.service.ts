import { Injectable } from '@nestjs/common';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { SkillsService } from '../skills/skills.service';
import { RagContextDto, RagSearchDto } from './rag-gateway.dto';

@Injectable()
export class RagGatewayService {
  constructor(
    private readonly karpathyRagService: KarpathyRagService,
    private readonly skillsService: SkillsService,
  ) {}

  async search(input: RagSearchDto, userId: string) {
    const limit = input.limit ?? 5;
    const chunks = await this.karpathyRagService.retrieve(input.query, {}, userId);
    const results = chunks.slice(0, limit).map((chunk) => ({
      id: chunk.id,
      chunkId: chunk.id,
      docId: chunk.docId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      headingPath: chunk.headingPath,
      sourceAuthority: chunk.sourceAuthority,
      bm25Score: chunk.bm25Score,
      cosineScore: chunk.cosineScore,
      totalScore: chunk.totalScore,
      score: chunk.totalScore,
    }));

    return {
      query: input.query,
      topK: limit,
      status: results.length > 0 ? 'ok' : 'insufficient_context',
      results,
      chunks: results,
    };
  }

  async context(input: RagContextDto, userId: string) {
    const search = await this.search(
      { query: input.task, limit: input.limit ?? 5 },
      userId,
    );
    const matchedSkills = input.matchSkill
      ? await this.skillsService.match(input.task, input.skillLimit ?? 3)
      : undefined;

    return {
      task: input.task,
      status: search.results.length > 0 ? 'ok' : 'insufficient_context',
      knowledge: search.results,
      matchedSkills,
      citations: search.results.map((chunk, index) => ({
        id: index + 1,
        docId: chunk.docId,
        chunkId: chunk.chunkId,
        score: chunk.totalScore,
      })),
      codingGuidance: {
        assumptions: [
          'Use retrieved knowledge as evidence, not as automatic code changes.',
        ],
        constraints: [
          'Do not modify .env, CI/CD, database schema, migrations, or production deployment configuration without explicit confirmation.',
          'Return insufficient_context instead of fabricating unsupported conclusions.',
        ],
        likelyFiles: input.includeRoadmap ? ['ROADMAP.md'] : [],
        validationCommands: ['backend npm run build', 'rag-cli pnpm run build'],
      },
      riskFlags: [
        'Production keys, real data, database migrations, and deployment changes require explicit confirmation.',
      ],
    };
  }
}
