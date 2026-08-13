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
    const [retrievedChunks, reviewedEvidence] = await Promise.all([
      this.karpathyRagService.retrieve(input.query, {}, userId),
      this.karpathyRagService.retrieveReviewedEvidence(input.query, 2),
    ]);
    const chunks = [...reviewedEvidence, ...retrievedChunks];
    const selectedChunks = chunks.slice(0, limit);
    const assessment =
      selectedChunks.length > 0
        ? this.karpathyRagService.assessRetrievedChunks(
            input.query,
            selectedChunks,
          )
        : {
            sufficient: false,
            reason: 'RAG 没有检索到候选片段',
          };
    const results = selectedChunks.map((chunk) => ({
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
      retrievalSource: chunk.retrievalSource,
      contextRole: chunk.contextRole,
    }));

    return {
      query: input.query,
      topK: limit,
      status: assessment.sufficient ? 'ok' : 'insufficient_context',
      retrievalSufficient: assessment.sufficient,
      retrievalReason: assessment.reason,
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
      status: search.status,
      retrievalSufficient: search.retrievalSufficient,
      retrievalReason: search.retrievalReason,
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
