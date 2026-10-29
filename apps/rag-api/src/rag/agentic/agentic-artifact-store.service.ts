import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AgenticStructuredArtifactEntity } from '../../providers/db/entities/agentic-structured-artifact.entity';
import { ArtifactDependencyEntity } from '../../providers/db/entities/artifact-dependency.entity';
import type { AgenticArtifact } from './agentic-rag.state';

@Injectable()
export class AgenticArtifactStoreService {
  constructor(
    @InjectRepository(AgenticStructuredArtifactEntity)
    private readonly structuredArtifactRepository: Repository<AgenticStructuredArtifactEntity>,
    @InjectRepository(ArtifactDependencyEntity)
    @Optional()
    private readonly artifactDependencyRepository?: Repository<ArtifactDependencyEntity>,
  ) {}

  async loadRunArtifacts(threadId: string): Promise<AgenticArtifact[]> {
    const rows = await this.structuredArtifactRepository.find({
      where: { threadId },
      order: { createdAt: 'ASC' },
    });
    return rows.flatMap((row) => {
      try {
        return [
          {
            id: row.artifactId,
            type: row.type as AgenticArtifact['type'],
            version: row.version as 1,
            producer: row.producer,
            createdAt: row.createdAt.toISOString(),
            payload: JSON.parse(row.payload) as unknown,
          },
        ];
      } catch {
        return [];
      }
    });
  }

  async saveRunArtifacts(
    threadId: string,
    userId: string | undefined,
    artifacts: AgenticArtifact[],
  ): Promise<void> {
    if (artifacts.length === 0) return;
    const rows = artifacts
      .filter(
        (artifact) => artifact.type !== 'subquestion_plan' || artifact.payload,
      )
      .map((artifact) => {
        const payload = this.recordOf(artifact.payload);
        const sourceDocIds = Array.isArray(payload.sourceDocIds)
          ? payload.sourceDocIds.filter(
              (item): item is string => typeof item === 'string',
            )
          : [];
        return this.structuredArtifactRepository.create({
          id: `${threadId}:${artifact.type}:${artifact.id}`.slice(0, 128),
          threadId,
          userId: userId ?? null,
          artifactId: artifact.id,
          type: artifact.type,
          producer: artifact.producer,
          version: artifact.version,
          status:
            typeof payload.status === 'string'
              ? payload.status
              : 'ready_for_review',
          payload: JSON.stringify(artifact.payload),
          sourceDocIds:
            sourceDocIds.length > 0 ? JSON.stringify(sourceDocIds) : null,
        });
      });
    if (rows.length > 0) {
      await this.structuredArtifactRepository.save(rows);
      if (!this.artifactDependencyRepository) return;
      const byType = new Map(rows.map((row) => [row.type, row.artifactId]));
      const dependencyTypes: Record<string, string[]> = {
        assumption_register: ['requirement_brief'],
        claim_evidence_matrix: ['requirement_brief'],
        solution_brief: [
          'requirement_brief',
          'assumption_register',
          'claim_evidence_matrix',
        ],
        api_contract: ['solution_brief'],
        event_tracking_plan: ['solution_brief'],
        test_plan: ['api_contract', 'event_tracking_plan', 'solution_brief'],
        acceptance_checklist: ['test_plan', 'risk_register'],
        risk_register: ['solution_brief'],
        rollout_plan: ['acceptance_checklist', 'risk_register'],
        code_context_pack: [
          'solution_brief',
          'api_contract',
          'event_tracking_plan',
          'test_plan',
        ],
      };
      const links = rows.flatMap((row) =>
        (dependencyTypes[row.type] ?? []).flatMap((type) => {
          const dependsOnArtifactId = byType.get(type);
          return dependsOnArtifactId
            ? [
                {
                  id: randomUUID(),
                  threadId,
                  artifactId: row.artifactId,
                  dependsOnArtifactId,
                  relation: 'input',
                },
              ]
            : [];
        }),
      );
      if (links.length > 0 && this.artifactDependencyRepository) {
        await this.artifactDependencyRepository.save(links);
      }
    }
  }

  private recordOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }
}
