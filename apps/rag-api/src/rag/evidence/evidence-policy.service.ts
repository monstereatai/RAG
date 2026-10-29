import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { QueryTaskType } from '../planning/query-plan';
import { AnswerQualityService } from './answer-quality.service';
import { DeterministicAnswerBuilder } from './deterministic-answer-builder';
import type { RetrievedChunk } from './retrieval.types';

/** Shared ranking, evidence sufficiency, and evidence-first answer policy. */
@Injectable()
export class EvidencePolicyService {
  readonly answerQuality: AnswerQualityService;
  readonly deterministicAnswerBuilder: DeterministicAnswerBuilder;

  constructor(configService: ConfigService) {
    this.answerQuality = new AnswerQualityService(configService);
    this.deterministicAnswerBuilder = new DeterministicAnswerBuilder(
      this.answerQuality,
    );
  }

  rankEvidenceChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return [...chunks].sort((left, right) => {
      const leftHasRerank = left.rerankScore !== undefined;
      const rightHasRerank = right.rerankScore !== undefined;
      if (leftHasRerank !== rightHasRerank) {
        return leftHasRerank ? -1 : 1;
      }
      const leftScore = leftHasRerank
        ? (left.rerankScore as number)
        : left.totalScore;
      const rightScore = rightHasRerank
        ? (right.rerankScore as number)
        : right.totalScore;
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }
      return left.id.localeCompare(right.id);
    });
  }

  assessRetrievedChunks(
    query: string,
    chunks: RetrievedChunk[],
    taskType: QueryTaskType = 'lookup',
  ): { sufficient: boolean; reason: string } {
    const attachmentEvidenceCount = chunks.filter(
      (chunk) => chunk.retrievalSource === 'attachment',
    ).length;
    if (attachmentEvidenceCount > 0) {
      return {
        sufficient: true,
        reason: `当前会话附件命中 ${attachmentEvidenceCount} 个片段`,
      };
    }
    return this.answerQuality.assessRetrievalQuality(query, chunks, taskType);
  }

  assessRetrievalQuality(
    query: string,
    chunks: RetrievedChunk[],
    taskType: QueryTaskType = 'lookup',
  ): { sufficient: boolean; reason: string } {
    return this.answerQuality.assessRetrievalQuality(query, chunks, taskType);
  }

  assessCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.answerQuality.assessCitationSupport(answer, chunks);
  }

  validateAnswerCitationSupport(
    answer: string,
    chunks: RetrievedChunk[],
  ): { sufficient: boolean; reason: string } {
    return this.assessCitationSupport(answer, chunks);
  }

  repairAnswerCitations(answer: string, chunks: RetrievedChunk[]): string {
    return this.answerQuality.attachMissingClaimCitations(answer, chunks);
  }

  selectCitedChunks(
    answer: string,
    chunks: RetrievedChunk[],
  ): RetrievedChunk[] {
    const indexes = Array.from(answer.matchAll(/\[片段\s*(\d+)\]/g))
      .map((match) => Number(match[1]) - 1)
      .filter((index) => Number.isInteger(index) && index >= 0);
    if (indexes.length === 0) return chunks;
    return Array.from(
      new Map(
        indexes
          .map((index) => chunks[index])
          .filter((chunk): chunk is RetrievedChunk => Boolean(chunk))
          .map((chunk) => [chunk.id, chunk]),
      ).values(),
    );
  }

  attachMissingClaimCitations(
    answer: string,
    chunks: RetrievedChunk[],
  ): string {
    return this.answerQuality.attachMissingClaimCitations(answer, chunks);
  }

  extractQualityTokens(text: string): Set<string> {
    return this.answerQuality.extractQualityTokens(text);
  }

  countTokenOverlap(tokens: Set<string>, text: string): number {
    return this.answerQuality.countTokenOverlap(tokens, text);
  }

  buildEvidenceFirstAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.deterministicAnswerBuilder.buildEvidenceFirstAnswer(
      query,
      chunks,
    );
  }

  buildDeterministicAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.deterministicAnswerBuilder.buildDeterministicAnswer(
      query,
      chunks,
    );
  }

  buildCitationSafeExtractiveAnswer(
    query: string,
    chunks: RetrievedChunk[],
  ): string | null {
    return this.deterministicAnswerBuilder.buildCitationSafeExtractiveAnswer(
      query,
      chunks,
    );
  }
}
