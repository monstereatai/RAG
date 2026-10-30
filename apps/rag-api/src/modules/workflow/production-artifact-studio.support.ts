import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../providers/llm/llm.provider';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { countTextTokens } from '../document/chunking.util';
import {
  PRODUCTION_ARTIFACT_TARGETS,
  type CodeFiles,
  type ProductionArtifactTarget,
  type ProductionCodeTarget,
  type ProductionSchemaTarget,
  type SchemaObject,
} from './production-artifact-studio.shared';

export abstract class ProductionArtifactStudioSupport {
  protected abstract readonly artifacts: ArtifactsService;
  protected abstract readonly llm: LlmProvider;
  protected abstract readonly configService: ConfigService;
  protected abstract readonly maxCodeEditBytes: number;

  protected toViewModel(target: ProductionCodeTarget, schema: SchemaObject) {
    if (target === 'vue-page' || target === 'react-page') {
      return {
        projectId: schema.projectId,
        title: schema.title,
        components: Array.isArray(schema.components)
          ? schema.components.map((item, index) => {
              const component = this.asObject(item);
              return {
                id:
                  this.stringField(component, 'id') || `component-${index + 1}`,
                type: this.stringField(component, 'type') || 'section',
                name:
                  this.stringField(component, 'name') ||
                  this.stringField(component, 'title') ||
                  `活动内容 ${index + 1}`,
                description: this.stringField(component, 'description'),
              };
            })
          : [],
      };
    }
    return {
      projectId: schema.projectId,
      title: schema.title,
      dataMode: schema.dataMode,
      widgets: Array.isArray(schema.widgets)
        ? schema.widgets.map((item) => {
            const widget = this.asObject(item);
            return {
              id: this.stringField(widget, 'id'),
              kind: this.stringField(widget, 'kind'),
              title: this.stringField(widget, 'title'),
              value:
                typeof widget.value === 'string' ||
                typeof widget.value === 'number'
                  ? widget.value
                  : null,
              unit: this.stringField(widget, 'unit'),
              labels: Array.isArray(widget.labels) ? widget.labels : [],
              values: Array.isArray(widget.values) ? widget.values : [],
            };
          })
        : [],
    };
  }

  protected async latestSchema(
    threadId: string,
    userId: string,
    target: ProductionSchemaTarget,
  ): Promise<{ id: string; sourceText: string } | null> {
    const items = await this.versionsForTarget(threadId, userId, target);
    const latest = items.sort(
      (a, b) => Number(b.metadata?.version) - Number(a.metadata?.version),
    )[0];
    if (!latest) return null;
    const artifact = await this.artifacts.getStudioVersion(
      String(latest.id),
      userId,
      threadId,
    );
    return { id: artifact.id, sourceText: artifact.sourceText };
  }

  protected async versionsForTarget(
    threadId: string,
    userId: string,
    target: ProductionArtifactTarget,
  ) {
    return (await this.artifacts.listStudioVersions(userId, threadId)).filter(
      (item) => item.metadata?.target === target && item.status === 'ready',
    );
  }

  protected targetOf(artifact: {
    metadata: string | null;
  }): ProductionArtifactTarget {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(artifact.metadata ?? '{}') as Record<
        string,
        unknown
      >;
    } catch {
      // Unreadable metadata is rejected below as an invalid target.
    }
    const target = metadata.target;
    if (
      typeof target !== 'string' ||
      !PRODUCTION_ARTIFACT_TARGETS.includes(target as ProductionArtifactTarget)
    ) {
      throw new BadRequestException('产物缺少有效的类型标记。');
    }
    return target as ProductionArtifactTarget;
  }

  protected isSchemaTarget(
    target: ProductionArtifactTarget,
  ): target is ProductionSchemaTarget {
    return target === 'activity-schema' || target === 'dashboard-schema';
  }

  protected parseStoredSchema(
    value: string,
    target: ProductionArtifactTarget,
  ): SchemaObject {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException('保存的 Schema 不是有效 JSON。');
    }
    if (!this.isSchemaTarget(target)) {
      throw new BadRequestException('代码产物不能作为 Schema 使用。');
    }
    this.validateSchema(target, this.asObject(parsed));
    return parsed as SchemaObject;
  }

  protected parseStoredCode(value: string): {
    framework: 'vue' | 'react';
    files: CodeFiles;
  } {
    try {
      const parsed = JSON.parse(value) as {
        framework?: unknown;
        files?: unknown;
      };
      if (
        (parsed.framework !== 'vue' && parsed.framework !== 'react') ||
        !parsed.files ||
        typeof parsed.files !== 'object' ||
        Array.isArray(parsed.files)
      ) {
        throw new Error('invalid');
      }
      const files = parsed.files as Record<string, unknown>;
      if (Object.values(files).some((source) => typeof source !== 'string')) {
        throw new Error('invalid');
      }
      return {
        framework: parsed.framework,
        files: files as Record<string, string>,
      };
    } catch {
      throw new BadRequestException('保存的代码源文件无效。');
    }
  }

  protected assertTargetFramework(
    target: ProductionArtifactTarget,
    framework: 'vue' | 'react',
  ) {
    const expected = target.startsWith('vue') ? 'vue' : 'react';
    if (framework !== expected) {
      throw new BadRequestException('代码版本的框架与产物类型不匹配。');
    }
  }

  protected editableCodePaths(framework: 'vue' | 'react') {
    return framework === 'vue'
      ? ['src/App.vue', 'src/style.css']
      : ['src/App.tsx', 'src/style.css'];
  }

  protected async assertInputWithinBudget(
    messages: Array<{ role: string; content: string }>,
    operation: string,
  ): Promise<void> {
    const text = messages.map((message) => message.content).join('\n');
    const estimatedInputTokens =
      (await countTextTokens(text)) + messages.length * 4;
    const configuredWindow = Number(
      this.configService.get<number>('llm.contextWindowTokens'),
    );
    const contextWindow =
      Number.isFinite(configuredWindow) && configuredWindow > 0
        ? configuredWindow
        : 32_768;
    const providers = [
      this.llm.getActiveProviderName(),
      this.llm.getFallbackProviderName(),
    ].filter((provider): provider is NonNullable<typeof provider> =>
      Boolean(provider),
    );
    const outputBudget = Math.max(
      ...providers.map((provider) =>
        Math.max(
          Number(this.configService.get<number>(`llm.${provider}.maxTokens`)) ||
            4_096,
          this.llm.getRoutePolicy('structured', provider).maxTokens,
        ),
      ),
    );
    const safetyMargin = Math.max(256, Math.ceil(contextWindow * 0.1));
    const maxInputTokens = Math.max(
      1,
      contextWindow - outputBudget - safetyMargin,
    );
    if (estimatedInputTokens > maxInputTokens) {
      throw new BadRequestException(
        `${operation}内容约 ${estimatedInputTokens} tokens，超过当前模型安全输入上限 ${maxInputTokens}；请缩小修改范围后重试。`,
      );
    }
  }

  protected validateCodeEditFiles(framework: 'vue' | 'react', value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('代码修改必须包含文件对象。');
    }
    const files = value as Record<string, unknown>;
    const paths = Object.keys(files);
    const allowed = this.editableCodePaths(framework);
    if (
      !paths.length ||
      paths.some((filePath) => !allowed.includes(filePath))
    ) {
      throw new BadRequestException(
        `只允许修改这些源码文件：${allowed.join(', ')}。`,
      );
    }
    if (Object.values(files).some((source) => typeof source !== 'string')) {
      throw new BadRequestException('代码文件内容必须是字符串。');
    }
    const byteLength = Object.values(files).reduce<number>(
      (total, source) => total + Buffer.byteLength(source as string, 'utf8'),
      0,
    );
    if (byteLength > this.maxCodeEditBytes) {
      throw new BadRequestException('修改后的源码不能超过 200 KB。');
    }
    return files as CodeFiles;
  }

  protected codeDiff(before: CodeFiles, changed: CodeFiles) {
    return Object.entries(changed)
      .filter(([filePath, after]) => before[filePath] !== after)
      .map(([path, after]) => ({ path, before: before[path] ?? '', after }));
  }

  protected metadataOf(value: string | null) {
    try {
      const metadata = JSON.parse(value ?? '{}') as unknown;
      return this.asObject(metadata);
    } catch {
      return {};
    }
  }

  protected validateSchema(
    target: ProductionSchemaTarget,
    value: SchemaObject,
  ) {
    const allowed =
      target === 'activity-schema'
        ? [
            'schemaVersion',
            'kind',
            'projectId',
            'title',
            'components',
            'apis',
            'events',
            'rules',
            'checks',
            'notes',
          ]
        : [
            'schemaVersion',
            'kind',
            'projectId',
            'title',
            'dataMode',
            'layout',
            'widgets',
            'notes',
          ];
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    const requiredKind =
      target === 'activity-schema'
        ? 'activity-page-schema'
        : 'dashboard-schema';
    if (
      unknown.length ||
      value.schemaVersion !== 1 ||
      value.kind !== requiredKind ||
      typeof value.projectId !== 'string' ||
      !value.projectId.trim() ||
      typeof value.title !== 'string' ||
      !value.title.trim()
    ) {
      throw new BadRequestException(
        `Schema 不符合 ${target} 的字段约定。${unknown.length ? ` 未知字段：${unknown.join(', ')}` : ''}`,
      );
    }
    const arrayFields =
      target === 'activity-schema'
        ? ['components', 'apis', 'events', 'rules', 'checks', 'notes']
        : ['widgets', 'notes'];
    for (const field of arrayFields) {
      if (
        !Array.isArray(value[field]) ||
        (value[field] as unknown[]).length > 100
      ) {
        throw new BadRequestException(`${field} 必须是最多 100 项的数组。`);
      }
    }
    if (target === 'dashboard-schema') {
      const layout = this.asObject(value.layout);
      if (
        !['unconfigured', 'mock'].includes(String(value.dataMode)) ||
        !Number.isInteger(layout.columns) ||
        Number(layout.columns) < 1 ||
        Number(layout.columns) > 24 ||
        !Number.isInteger(layout.refreshSeconds) ||
        Number(layout.refreshSeconds) < 5 ||
        Number(layout.refreshSeconds) > 3_600
      ) {
        throw new BadRequestException(
          'Dashboard Schema 的数据模式或布局配置无效。',
        );
      }
      for (const item of value.widgets as unknown[]) {
        const widget = this.asObject(item);
        if (
          typeof widget.id !== 'string' ||
          typeof widget.title !== 'string' ||
          !['metric', 'bar'].includes(String(widget.kind)) ||
          (widget.kind === 'metric' &&
            widget.value !== null &&
            typeof widget.value !== 'string' &&
            (typeof widget.value !== 'number' ||
              !Number.isFinite(widget.value))) ||
          (widget.kind === 'bar' &&
            (!Array.isArray(widget.labels) ||
              !Array.isArray(widget.values) ||
              widget.labels.length !== widget.values.length ||
              widget.labels.length > 24 ||
              widget.labels.some((label) => typeof label !== 'string') ||
              widget.values.some(
                (data) =>
                  typeof data !== 'number' ||
                  !Number.isFinite(data) ||
                  data < 0,
              )))
        ) {
          throw new BadRequestException('Dashboard widget 配置无效。');
        }
      }
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 64 * 1024) {
      throw new BadRequestException('Schema 大小不能超过 64 KB。');
    }
  }

  protected parseModelJson(value: string): SchemaObject {
    const content = value.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
      return this.asObject(JSON.parse(content));
    } catch {
      throw new BadRequestException('模型返回的内容不是有效 JSON object。');
    }
  }

  protected diff(before: unknown, after: unknown) {
    const changes: Array<{ path: string; before?: unknown; after?: unknown }> =
      [];
    const visit = (left: unknown, right: unknown, path = '$') => {
      if (JSON.stringify(left) === JSON.stringify(right)) return;
      if (
        left &&
        right &&
        typeof left === 'object' &&
        typeof right === 'object' &&
        !Array.isArray(left) &&
        !Array.isArray(right)
      ) {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) {
          visit(
            (left as Record<string, unknown>)[key],
            (right as Record<string, unknown>)[key],
            `${path}.${key}`,
          );
          if (changes.length >= 100) break;
        }
      } else {
        changes.push({ path, before: left, after: right });
      }
    };
    visit(before, after);
    return changes;
  }

  protected schemaPreview(schema: SchemaObject) {
    const title = this.escapeHtml(String(schema.title));
    if (schema.kind === 'dashboard-schema') {
      const widgets = (schema.widgets as unknown[])
        .map((item) => {
          const widget = this.asObject(item);
          const value =
            widget.kind === 'metric'
              ? `<strong>${this.escapeHtml(typeof widget.value === 'string' || typeof widget.value === 'number' ? String(widget.value) : '--')}</strong><small>${this.escapeHtml(this.stringField(widget, 'unit'))}</small>`
              : this.previewBars(widget);
          return `<article><h2>${this.escapeHtml(this.stringField(widget, 'title'))}</h2>${value}</article>`;
        })
        .join('');
      return this.previewHtml(
        `<main class="board"><p>数字大屏 / ${String(schema.dataMode) === 'mock' ? '模拟数据' : '未连接数据源'}</p><h1>${title}</h1><section>${widgets || '<article>尚未配置组件</article>'}</section></main>`,
        true,
      );
    }
    const components = (schema.components as unknown[])
      .map((item) => {
        const component = this.asObject(item);
        const name = this.escapeHtml(
          this.stringField(component, 'name') ||
            this.stringField(component, 'title') ||
            '活动内容',
        );
        const type = this.escapeHtml(
          this.stringField(component, 'type') || 'section',
        );
        const id = this.escapeHtml(
          this.stringField(component, 'id') || 'component',
        );
        return `<article><small>${type} · ${id}</small><h2>${name}</h2><p>组件配置可继续在 Schema 中补充。</p></article>`;
      })
      .join('');
    return this.previewHtml(
      `<main class="page"><header><small>活动页面 / Schema 预览</small><h1>${title}</h1><p>此预览根据当前活动 Schema 生成。</p></header><section>${components || '<article><h2>待补充活动组件</h2><p>当前 Schema 尚未包含页面组件。</p></article>'}</section></main>`,
      false,
    );
  }

  protected previewHtml(content: string, dark: boolean) {
    const style = dark
      ? 'body{margin:0;background:#071522;color:#e9f1fb;font:16px sans-serif}.board{max-width:1400px;margin:auto;padding:5vw}.board>p{color:#9eb4c4}.board section{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.board article{padding:24px;border:1px solid #23445c;border-radius:14px;background:#0b1e2d}.board h2{font-size:16px;font-weight:500}.board strong{font-size:40px}.board small{color:#9eb4c4}.bars{display:flex;align-items:end;gap:12px;height:132px;margin-top:18px}.bar-item{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px}.bar-item strong{font-size:13px}.bar-column{height:84px;width:100%;display:flex;align-items:end;background:#102c3e}.bar-fill{display:block;width:100%;min-height:4px;background:#85b8d2}.bar-item small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      : 'body{margin:0;background:#f4f6f5;color:#192a36;font:16px sans-serif}.page{max-width:1000px;margin:auto;padding:5vw}.page header{padding:36px;border-radius:20px;background:#183c3b;color:white}.page header small,.page header p{color:#c2d6ca}.page section{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:18px}.page article{padding:22px;border:1px solid #dce4de;border-radius:14px;background:white}.page article small{color:#66766e}';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>${style}</style></head><body>${content}</body></html>`;
  }

  protected previewBars(widget: SchemaObject) {
    const values = Array.isArray(widget.values)
      ? (widget.values as number[])
      : [];
    if (!values.length) {
      return '<div class="empty">连接或配置数据后显示</div>';
    }
    const labels = Array.isArray(widget.labels)
      ? (widget.labels as string[])
      : [];
    const maximum = Math.max(...values, 1);
    const items = values
      .map((value, index) => {
        const height = Math.max(6, Math.round((value / maximum) * 100));
        const label = this.escapeHtml(String(labels[index] ?? index + 1));
        return `<div class="bar-item"><strong>${value}</strong><div class="bar-column"><span class="bar-fill" style="height:${height}%"></span></div><small>${label}</small></div>`;
      })
      .join('');
    return `<div class="bars">${items}</div>`;
  }

  protected auditFor(value: string | null) {
    try {
      const metadata = JSON.parse(value ?? '{}') as Record<string, unknown>;
      return Array.isArray(metadata.simulatedSyncAudit)
        ? (metadata.simulatedSyncAudit as Array<Record<string, unknown>>)
        : [];
    } catch {
      return [];
    }
  }

  protected stringField(value: SchemaObject, key: string) {
    return typeof value[key] === 'string' ? String(value[key]) : '';
  }

  protected asObject(value: unknown): SchemaObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as SchemaObject)
      : {};
  }

  protected safeJson(value: unknown) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  protected escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  }
}
