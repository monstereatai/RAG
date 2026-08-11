import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { WorkflowTemplateEntity } from '../../providers/db/entities/workflow-template.entity';
import { WorkflowTemplateVersionEntity } from '../../providers/db/entities/workflow-template-version.entity';
import { PlatformPluginEntity } from '../../providers/db/entities/platform-plugin.entity';
import { ModelRegistryEntity } from '../../providers/db/entities/model-registry.entity';
import { EvaluationCaseEntity } from '../../providers/db/entities/evaluation-case.entity';
import { KarpathyRagService } from '../../rag/karpathy/karpathy-rag.service';
import { KnowledgeBaseProfileEntity } from '../../providers/db/entities/knowledge-base-profile.entity';
import { detectRetrievalProfile } from '../../rag/karpathy/context-builder';

const DEFAULT_PLUGINS = [
  { key: 'rag.search', type: 'tool', version: '1.0.0', capabilities: ['hybrid-search', 'graph-search'], permissions: ['knowledge.read'] },
  { key: 'rag.mcp', type: 'mcp', version: '1.0.0', capabilities: ['rag_context', 'rag_game_plan', 'rag_graph_search'], permissions: ['knowledge.read'] },
  { key: 'web.search', type: 'tool', version: '1.0.0', capabilities: ['web-search'], permissions: ['network.outbound'] },
];

const DEFAULT_MODELS = [
  { provider: 'qwen', model: 'qwen-plus', capabilities: ['chat', 'tool-call', 'stream'], pricing: { input: 0, output: 0, currency: 'CNY', source: 'env' } },
  { provider: 'deepseek', model: 'deepseek-chat', capabilities: ['chat', 'tool-call', 'stream'], pricing: { input: 0, output: 0, currency: 'CNY', source: 'env' } },
  { provider: 'qwen', model: 'text-embedding-v3', capabilities: ['embedding'], pricing: { input: 0, output: 0, currency: 'CNY', source: 'env' } },
];

const DEFAULT_KNOWLEDGE_BASE_PROFILES = [
  { key: 'prd', name: '产品需求与活动方案', documentType: 'prd', chunkSize: 650, chunkOverlap: 80 },
  { key: 'api', name: '接口与埋点规范', documentType: 'api', chunkSize: 700, chunkOverlap: 40 },
  { key: 'design', name: '设计与素材规范', documentType: 'design', chunkSize: 600, chunkOverlap: 60 },
  { key: 'test', name: '测试与验收清单', documentType: 'test', chunkSize: 550, chunkOverlap: 50 },
  { key: 'general', name: '通用知识库', documentType: 'general', chunkSize: 500, chunkOverlap: 50 },
];

@Injectable()
export class PlatformGovernanceService {
  constructor(
    @InjectRepository(WorkflowTemplateEntity) private readonly workflowRepo: Repository<WorkflowTemplateEntity>,
    @InjectRepository(WorkflowTemplateVersionEntity) private readonly versionRepo: Repository<WorkflowTemplateVersionEntity>,
    @InjectRepository(PlatformPluginEntity) private readonly pluginRepo: Repository<PlatformPluginEntity>,
    @InjectRepository(ModelRegistryEntity) private readonly modelRepo: Repository<ModelRegistryEntity>,
    @InjectRepository(EvaluationCaseEntity) private readonly evalRepo: Repository<EvaluationCaseEntity>,
    @InjectRepository(KnowledgeBaseProfileEntity) private readonly profileRepo: Repository<KnowledgeBaseProfileEntity>,
    private readonly rag: KarpathyRagService,
  ) {}

  async listWorkflows(workspaceId = 'default') {
    return this.workflowRepo.find({ where: { workspaceId }, order: { updatedAt: 'DESC' } });
  }

  async createWorkflow(input: { key: string; name: string; description?: string; definition: unknown; workspaceId?: string; ownerId?: string }) {
    const workspaceId = input.workspaceId ?? 'default';
    const existing = await this.workflowRepo.findOne({ where: { key: input.key, workspaceId } });
    if (existing) throw new BadRequestException(`workflow ${input.key} already exists`);
    const template = await this.workflowRepo.save(this.workflowRepo.create({
      id: randomUUID(), key: input.key, name: input.name, description: input.description ?? null,
      workspaceId, ownerId: input.ownerId ?? null, status: 'draft', activeVersion: 0,
    }));
    await this.versionRepo.save(this.versionRepo.create({
      id: randomUUID(), templateId: template.id, version: 1, definition: JSON.stringify(input.definition), status: 'draft', createdBy: input.ownerId ?? null,
    }));
    return this.getWorkflow(template.id);
  }

  async getWorkflow(id: string) {
    const template = await this.workflowRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException('workflow template not found');
    const versions = await this.versionRepo.find({ where: { templateId: id }, order: { version: 'DESC' } });
    return { ...template, versions: versions.map((item) => ({ ...item, definition: this.parseJson(item.definition, {}) })) };
  }

  async publishWorkflow(id: string, version: number) {
    const template = await this.workflowRepo.findOne({ where: { id } });
    const target = await this.versionRepo.findOne({ where: { templateId: id, version } });
    if (!template || !target) throw new NotFoundException('workflow version not found');
    await this.versionRepo.update({ templateId: id, status: 'published' }, { status: 'rolled_back' });
    target.status = 'published';
    await this.versionRepo.save(target);
    template.activeVersion = version;
    template.status = 'published';
    await this.workflowRepo.save(template);
    return this.getWorkflow(id);
  }

  async cloneWorkflow(id: string, input: { key: string; name?: string; ownerId?: string }) {
    const source = await this.getWorkflow(id);
    const definition = source.versions.find((item) => item.status === 'published')?.definition
      ?? source.versions[0]?.definition;
    if (!definition) throw new BadRequestException('workflow has no version to clone');
    return this.createWorkflow({
      key: input.key,
      name: input.name ?? `${source.name}（副本）`,
      description: source.description ?? undefined,
      definition,
      workspaceId: source.workspaceId,
      ownerId: input.ownerId,
    });
  }

  async listPlugins() {
    const stored = await this.pluginRepo.find({ order: { key: 'ASC', version: 'DESC' } });
    return stored.length > 0 ? stored : DEFAULT_PLUGINS.map((item) => ({ ...item, status: 'enabled', timeoutMs: 5000 }));
  }

  async listModels() {
    const stored = await this.modelRepo.find({ order: { provider: 'ASC', model: 'ASC' } });
    return stored.length > 0 ? stored : DEFAULT_MODELS.map((item) => ({ ...item, status: 'enabled', fallbackModel: null }));
  }

  async registerPlugin(input: { key: string; type: PlatformPluginEntity['type']; version: string; capabilities?: string[]; permissions?: string[]; timeoutMs?: number }) {
    return this.pluginRepo.save(this.pluginRepo.create({ id: randomUUID(), key: input.key, type: input.type, version: input.version, capabilities: JSON.stringify(input.capabilities ?? []), permissions: JSON.stringify(input.permissions ?? []), timeoutMs: input.timeoutMs ?? 5000, status: 'enabled' }));
  }

  async registerModel(input: { provider: string; model: string; capabilities?: string[]; pricing?: Record<string, unknown>; fallbackModel?: string }) {
    return this.modelRepo.save(this.modelRepo.create({ id: randomUUID(), provider: input.provider, model: input.model, capabilities: JSON.stringify(input.capabilities ?? []), pricing: JSON.stringify(input.pricing ?? {}), fallbackModel: input.fallbackModel ?? null, status: 'enabled' }));
  }

  async createEvaluationCase(input: { query: string; expectedAnswer: string; expectedReferences?: string[]; sourceFeedbackId?: string; workspaceId?: string; createdBy?: string }) {
    if (!input.query?.trim() || !input.expectedAnswer?.trim()) throw new BadRequestException('query and expectedAnswer are required');
    return this.evalRepo.save(this.evalRepo.create({ id: randomUUID(), query: input.query.trim(), expectedAnswer: input.expectedAnswer.trim(), expectedReferences: JSON.stringify(input.expectedReferences ?? []), sourceFeedbackId: input.sourceFeedbackId ?? null, workspaceId: input.workspaceId ?? 'default', createdBy: input.createdBy ?? null, status: 'active' }));
  }

  async listEvaluationCases(workspaceId = 'default') {
    return this.evalRepo.find({ where: { workspaceId, status: 'active' }, order: { createdAt: 'DESC' }, take: 200 });
  }

  async listKnowledgeBaseProfiles(workspaceId = 'default') {
    const stored = await this.profileRepo.find({ where: { workspaceId, status: 'enabled' }, order: { key: 'ASC' } });
    return stored.length > 0 ? stored : DEFAULT_KNOWLEDGE_BASE_PROFILES.map((item) => ({ ...item, workspaceId, status: 'enabled', retrievalConfig: '{}', syncConfig: '{}' }));
  }

  async registerKnowledgeBaseProfile(input: {
    key: string;
    name: string;
    workspaceId?: string;
    documentType?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    retrievalConfig?: Record<string, unknown>;
    syncConfig?: Record<string, unknown>;
  }) {
    if (!input.key?.trim() || !input.name?.trim()) throw new BadRequestException('key and name are required');
    const chunkSize = Number(input.chunkSize ?? 500);
    const chunkOverlap = Number(input.chunkOverlap ?? 50);
    if (!Number.isInteger(chunkSize) || chunkSize < 200 || chunkSize > 4000) throw new BadRequestException('chunkSize must be between 200 and 4000');
    if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) throw new BadRequestException('chunkOverlap must be smaller than chunkSize');
    const workspaceId = input.workspaceId ?? 'default';
    const existing = await this.profileRepo.findOne({ where: { key: input.key.trim(), workspaceId } });
    const entity = existing ?? this.profileRepo.create({ id: randomUUID(), key: input.key.trim(), workspaceId });
    entity.name = input.name.trim();
    entity.documentType = input.documentType ?? entity.documentType ?? 'general';
    entity.chunkSize = chunkSize;
    entity.chunkOverlap = chunkOverlap;
    entity.retrievalConfig = JSON.stringify(input.retrievalConfig ?? {});
    entity.syncConfig = JSON.stringify(input.syncConfig ?? {});
    entity.status = 'enabled';
    return this.profileRepo.save(entity);
  }

  async debugRetrieval(query: string, userId: string, options: { vectorSearch?: boolean; scope?: string; profile?: string } = {}) {
    if (!query?.trim()) throw new BadRequestException('query is required');
    const scope = options.scope ? this.parseJson(options.scope, undefined) as Record<string, unknown> | undefined : undefined;
    let profile = detectRetrievalProfile(query.trim());
    if (options.profile) {
      const config = await this.profileRepo.findOne({ where: { key: options.profile, workspaceId: 'default', status: 'enabled' } });
      if (config) profile = { ...profile, ...this.parseJson(config.retrievalConfig, {}) as Partial<typeof profile> };
    }
    const result = await this.rag.retrieveDetailed(query.trim(), { vectorSearch: options.vectorSearch, scope, profile }, userId);
    return { query: query.trim(), profile: result.profile, diagnostics: result.diagnostics, stages: { final: result.chunks, count: result.chunks.length }, generatedAt: new Date().toISOString() };
  }

  private parseJson(value: string, fallback: unknown) {
    try { return JSON.parse(value); } catch { return fallback; }
  }
}
