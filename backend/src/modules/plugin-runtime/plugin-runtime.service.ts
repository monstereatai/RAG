import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { PlatformPluginEntity } from '../../providers/db/entities/platform-plugin.entity';
import { BUILTIN_PLUGIN_MANIFESTS, isKnownTool, isToolAllowedInMode, type PluginManifest, type PluginMode, type PluginType } from './plugin-manifest';

type PersistedManifest = Partial<PluginManifest> & { manifest?: Partial<PluginManifest> };

@Injectable()
export class PluginRuntimeService {
  constructor(
    @InjectRepository(PlatformPluginEntity)
    private readonly pluginRepo: Repository<PlatformPluginEntity>,
  ) {}

  async list(): Promise<PluginManifest[]> {
    const stored = await this.pluginRepo.find({ order: { key: 'ASC', version: 'DESC' } });
    const catalog = new Map(BUILTIN_PLUGIN_MANIFESTS.map((item) => [this.identity(item), item]));
    stored.map((item) => this.fromEntity(item)).forEach((item) => catalog.set(this.identity(item), item));
    return [...catalog.values()].sort((left, right) => left.key.localeCompare(right.key) || right.version.localeCompare(left.version));
  }

  async register(input: Partial<PluginManifest>): Promise<PluginManifest> {
    const manifest = this.normalizeInput(input);
    const existing = await this.pluginRepo.findOne({ where: { key: manifest.key, version: manifest.version } });
    const entity = existing ?? this.pluginRepo.create({ id: randomUUID(), key: manifest.key, version: manifest.version, type: manifest.type });
    entity.type = manifest.type;
    entity.status = manifest.status;
    entity.timeoutMs = 5_000;
    entity.permissions = JSON.stringify(manifest.permissions);
    entity.capabilities = JSON.stringify({ manifest });
    return this.fromEntity(await this.pluginRepo.save(entity));
  }

  async setStatus(key: string, version: string, status: PluginManifest['status']): Promise<PluginManifest> {
    const entity = await this.pluginRepo.findOne({ where: { key, version } });
    if (!entity) throw new NotFoundException(`plugin ${key}@${version} not found`);
    entity.status = status;
    return this.fromEntity(await this.pluginRepo.save(entity));
  }

  async resolve(keys: string[] | undefined, mode: PluginMode, fallbackKeys: string[] = []): Promise<{ pluginKeys: string[]; toolNames: string[]; manifests: PluginManifest[] }> {
    const requested = [...new Set((keys?.length ? keys : fallbackKeys).map((item) => item.trim()).filter(Boolean))];
    if (requested.length === 0) return { pluginKeys: [], toolNames: [], manifests: [] };
    const catalog = new Map<string, PluginManifest>();
    for (const item of await this.list()) {
      if (!catalog.has(item.key)) catalog.set(item.key, item);
    }
    const selected = new Map<string, PluginManifest>();
    const visit = (key: string, path: string[] = []) => {
      if (path.includes(key)) throw new BadRequestException(`插件依赖存在循环：${[...path, key].join(' → ')}`);
      if (selected.has(key)) return;
      const manifest = catalog.get(key);
      if (!manifest) throw new BadRequestException(`插件 ${key} 未注册。请先在平台治理中登记。`);
      if (manifest.status !== 'enabled') throw new BadRequestException(`插件 ${key} 当前为 ${manifest.status}，不能组合使用。`);
      if (!manifest.modes.includes(mode)) throw new BadRequestException(`插件 ${key} 不支持 ${mode} 链路。`);
      (manifest.requires ?? []).forEach((dependency) => visit(dependency, [...path, key]));
      selected.set(key, manifest);
    };
    requested.forEach((key) => visit(key));
    const manifests = [...selected.values()];
    const selectedKeys = new Set(manifests.map((item) => item.key));
    manifests.forEach((manifest) => {
      const conflict = (manifest.conflicts ?? []).find((item) => selectedKeys.has(item));
      if (conflict) throw new BadRequestException(`插件 ${manifest.key} 与 ${conflict} 不能同时启用。`);
      const incompatibleTool = manifest.tools.find((tool) => !isToolAllowedInMode(tool, mode));
      if (incompatibleTool) throw new BadRequestException(`插件 ${manifest.key} 引用了不支持 ${mode} 链路的工具 ${incompatibleTool}。`);
    });
    return {
      pluginKeys: manifests.map((item) => item.key),
      toolNames: [...new Set(manifests.flatMap((item) => item.tools))],
      manifests,
    };
  }

  private normalizeInput(input: Partial<PluginManifest>): PluginManifest {
    const key = String(input.key ?? '').trim();
    if (!/^[a-z][a-z0-9._-]{2,127}$/.test(key)) throw new BadRequestException('插件标识仅允许小写字母、数字、点、下划线和连字符，且长度至少为 3。');
    const version = String(input.version ?? '1.0.0').trim();
    const modes = this.asModes(input.modes);
    const tools = this.asStrings(input.tools);
    const unknown = tools.find((tool) => !isKnownTool(tool));
    if (unknown) throw new BadRequestException(`工具 ${unknown} 尚未在 Tool Registry 注册，不能被插件引用。`);
    return {
      key, version,
      displayName: String(input.displayName ?? key).trim().slice(0, 128),
      description: String(input.description ?? '').trim().slice(0, 1_000),
      type: this.asType(input.type), capabilities: this.asStrings(input.capabilities), permissions: this.asStrings(input.permissions), tools, modes,
      requires: this.asStrings(input.requires), conflicts: this.asStrings(input.conflicts),
      status: input.status === 'disabled' || input.status === 'degraded' ? input.status : 'enabled', builtin: false,
    };
  }

  private fromEntity(entity: PlatformPluginEntity): PluginManifest {
    const parsed = this.parseJson<PersistedManifest | string[]>(entity.capabilities, []);
    const nested = !Array.isArray(parsed) && parsed.manifest ? parsed.manifest : parsed;
    return {
      key: entity.key, version: entity.version,
      displayName: String(!Array.isArray(nested) ? nested.displayName ?? entity.key : entity.key),
      description: String(!Array.isArray(nested) ? nested.description ?? '' : ''), type: entity.type,
      capabilities: this.asStrings(!Array.isArray(nested) ? nested.capabilities : nested),
      permissions: this.asStrings(this.parseJson(entity.permissions, [])),
      tools: this.asStrings(!Array.isArray(nested) ? nested.tools : []),
      modes: this.asModes(!Array.isArray(nested) ? nested.modes : undefined),
      requires: this.asStrings(!Array.isArray(nested) ? nested.requires : []), conflicts: this.asStrings(!Array.isArray(nested) ? nested.conflicts : []),
      status: entity.status, builtin: false,
    };
  }

  private identity(item: Pick<PluginManifest, 'key' | 'version'>) { return `${item.key}@${item.version}`; }
  private parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
  private asStrings(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : []; }
  private asModes(value: unknown): PluginMode[] {
    const modes = this.asStrings(value).filter((item): item is PluginMode => ['simple', 'auto', 'agentic', 'production'].includes(item));
    return modes.length > 0 ? modes : ['agentic', 'production'];
  }
  private asType(value: unknown): PluginType {
    return ['model', 'tool', 'mcp', 'datasource', 'agent_strategy', 'trigger'].includes(String(value)) ? value as PluginType : 'tool';
  }
}
