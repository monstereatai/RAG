import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AgentSopEntity } from '../../providers/db/entities/agent-sop.entity';
import { AgentCollaborationMessageEntity } from '../../providers/db/entities/agent-collaboration-message.entity';
import { ArtifactDependencyEntity } from '../../providers/db/entities/artifact-dependency.entity';
import { DecisionRecordEntity } from '../../providers/db/entities/decision-record.entity';
import { AgentRunEntity } from '../../providers/db/entities/agent-run.entity';
import { AgentActionEntity } from '../../providers/db/entities/agent-action.entity';
import { AgenticStructuredArtifactEntity } from '../../providers/db/entities/agentic-structured-artifact.entity';
import { AgentRuntimeEventsService } from '../agent-runtime-events/agent-runtime-events.service';

const DEFAULT_SOPS = [
  ['product', '产品需求 SOP', ['brief', '目标、范围、用户故事'], ['rag.search', '需求拆解'], ['requirement_brief', 'acceptance_checklist'], []],
  ['design', '设计方案 SOP', ['requirement_brief', '用户体验约束'], ['rag.search', 'design.check'], ['solution_brief'], ['product']],
  ['frontend', '前端实现 SOP', ['solution_brief', '组件规范'], ['rag.search', 'code.context'], ['code_context_pack'], ['design']],
  ['backend', '后端接口 SOP', ['solution_brief', '接口规范'], ['rag.search', 'api.check'], ['api_contract'], ['product']],
  ['qa', '测试验收 SOP', ['api_contract', 'solution_brief'], ['rag.search', 'eval.run'], ['test_plan', 'acceptance_checklist'], ['frontend', 'backend']],
  ['operations', '运营上线 SOP', ['risk_register', 'acceptance_checklist'], ['rag.search', 'region.check'], ['risk_register', 'rollout_plan'], ['product', 'qa']],
] as const;

@Injectable()
export class AgentCollaborationService {
  constructor(
    @InjectRepository(AgentSopEntity) private readonly sops: Repository<AgentSopEntity>,
    @InjectRepository(AgentCollaborationMessageEntity) private readonly messages: Repository<AgentCollaborationMessageEntity>,
    @InjectRepository(ArtifactDependencyEntity) private readonly dependencies: Repository<ArtifactDependencyEntity>,
    @InjectRepository(DecisionRecordEntity) private readonly decisions: Repository<DecisionRecordEntity>,
    @InjectRepository(AgentRunEntity) private readonly runs: Repository<AgentRunEntity>,
    @InjectRepository(AgentActionEntity) private readonly actions: Repository<AgentActionEntity>,
    @InjectRepository(AgenticStructuredArtifactEntity) private readonly artifacts: Repository<AgenticStructuredArtifactEntity>,
    private readonly events: AgentRuntimeEventsService,
  ) {}

  async listSops() {
    const stored = await this.sops.find({ order: { role: 'ASC' } });
    if (stored.length > 0) return stored.map((item) => this.viewSop(item));
    return DEFAULT_SOPS.map(([role, name, inputContract, actions, outputContract, dependencies]) => ({
      id: `default:${role}`, key: `production.${role}`, role, name, version: 1, status: 'published',
      inputContract, actions, outputContract, dependencies, maxSteps: 6,
    }));
  }

  async upsertSop(input: { key: string; role: string; name: string; inputContract?: unknown; actions?: unknown; outputContract?: unknown; dependencies?: unknown; maxSteps?: number }) {
    const existing = await this.sops.findOne({ where: { key: input.key } });
    const entity = existing ?? this.sops.create({ id: randomUUID(), key: input.key });
    entity.role = input.role;
    entity.name = input.name;
    entity.version = existing ? existing.version + 1 : 1;
    entity.status = 'published';
    entity.inputContract = this.json(input.inputContract ?? []);
    entity.actions = this.json(input.actions ?? []);
    entity.outputContract = this.json(input.outputContract ?? []);
    entity.dependencies = this.json(input.dependencies ?? []);
    entity.maxSteps = Math.min(Math.max(Number(input.maxSteps ?? 6), 1), 18);
    return this.viewSop(await this.sops.save(entity));
  }

  async publishMessage(input: { threadId: string; runId?: string; fromRole: string; toRole: string; messageType?: string; subject: string; payload?: unknown; artifactIds?: string[] }) {
    const entity = this.messages.create({
      id: randomUUID(), threadId: input.threadId, runId: input.runId ?? null,
      fromRole: input.fromRole, toRole: input.toRole, messageType: input.messageType ?? 'handoff',
      subject: input.subject, payload: this.json(input.payload ?? {}), artifactIds: this.json(input.artifactIds ?? []), status: 'published',
    });
    const saved = await this.messages.save(entity);
    await this.events.emit({ threadId: input.threadId, runId: input.runId, eventType: 'message.published', actor: input.fromRole, target: input.toRole, payload: { messageType: input.messageType ?? 'handoff', subject: input.subject, artifactIds: input.artifactIds ?? [] } });
    return this.viewMessage(saved);
  }

  async listMessages(threadId?: string) {
    const rows = await this.messages.find({ where: threadId ? { threadId } : {}, order: { createdAt: 'ASC' }, take: 500 });
    return rows.map((item) => this.viewMessage(item));
  }

  async recordDependencies(threadId: string, links: Array<{ artifactId: string; dependsOnArtifactId: string; relation?: string }>) {
    if (links.length === 0) return [];
    const rows = links.map((link) => this.dependencies.create({ id: randomUUID(), threadId, artifactId: link.artifactId, dependsOnArtifactId: link.dependsOnArtifactId, relation: link.relation ?? 'input' }));
    return this.dependencies.save(rows);
  }

  async listDependencies(threadId?: string) {
    return this.dependencies.find({ where: threadId ? { threadId } : {}, order: { createdAt: 'ASC' }, take: 1000 });
  }

  async createDecision(input: { threadId: string; projectId?: string; title: string; conflicts?: unknown; options?: unknown; decision?: unknown; rationale?: string; sourceArtifactIds?: string[]; createdBy?: string }) {
    const entity = this.decisions.create({
      id: randomUUID(), threadId: input.threadId, projectId: input.projectId ?? null, title: input.title,
      status: 'draft', conflicts: this.json(input.conflicts ?? []), options: this.json(input.options ?? []),
      decision: this.json(input.decision ?? {}), rationale: input.rationale ?? '', sourceArtifactIds: this.json(input.sourceArtifactIds ?? []), createdBy: input.createdBy ?? null,
    });
    const saved = await this.decisions.save(entity);
    await this.events.emit({ threadId: input.threadId, eventType: 'decision.required', actor: input.createdBy ?? 'admin', target: 'human', payload: { decisionId: saved.id, title: input.title, conflicts: input.conflicts ?? [] } });
    return this.viewDecision(saved);
  }

  async listDecisions(threadId?: string) {
    const rows = await this.decisions.find({ where: threadId ? { threadId } : {}, order: { createdAt: 'DESC' }, take: 200 });
    return rows.map((item) => this.viewDecision(item));
  }

  async detectConflicts(threadId: string) {
    const messages = await this.listMessages(threadId);
    const bySubject = new Map<string, any[]>();
    for (const message of messages) {
      const list = bySubject.get(message.subject) ?? [];
      list.push(message);
      bySubject.set(message.subject, list);
    }
    return [...bySubject.entries()].flatMap(([subject, list]) => {
      const signatures = [...new Set(list.map((item) => JSON.stringify(item.payload?.decision ?? item.payload?.recommendation ?? item.payload?.status ?? item.payload)))];
      return signatures.length > 1 ? [{ subject, messages: list, signatures, status: 'conflict' }] : [];
    });
  }

  async collaborationSnapshot(threadId: string) {
    const [run, actions, artifacts, messages, dependencies, decisions] = await Promise.all([
      this.runs.findOne({ where: { threadId }, order: { createdAt: 'DESC' } }),
      this.runs.findOne({ where: { threadId }, order: { createdAt: 'DESC' } }).then((item) => item ? this.actions.find({ where: { runId: item.id }, order: { createdAt: 'ASC' } }) : []),
      this.artifacts.find({ where: { threadId }, order: { createdAt: 'ASC' } }),
      this.listMessages(threadId), this.listDependencies(threadId), this.listDecisions(threadId),
    ]);
    return { threadId, run, actions, artifacts: artifacts.map((item) => ({ ...item, payload: this.parse(item.payload, {}) })), messages, dependencies, decisions };
  }

  private viewSop(item: AgentSopEntity) { return { ...item, inputContract: this.parse(item.inputContract, []), actions: this.parse(item.actions, []), outputContract: this.parse(item.outputContract, []), dependencies: this.parse(item.dependencies, []) }; }
  private viewMessage(item: AgentCollaborationMessageEntity) { return { ...item, payload: this.parse(item.payload, {}), artifactIds: this.parse(item.artifactIds, []) }; }
  private viewDecision(item: DecisionRecordEntity) { return { ...item, conflicts: this.parse(item.conflicts, []), options: this.parse(item.options, []), decision: this.parse(item.decision, {}), sourceArtifactIds: this.parse(item.sourceArtifactIds, []) }; }
  private json(value: unknown) { return JSON.stringify(value ?? {}); }
  private parse(value: string, fallback: unknown) { try { return JSON.parse(value); } catch { return fallback; } }
}
