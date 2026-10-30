import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RetrievalScopeDto } from '../chat/chat.dto';
import type { ChatService } from '../chat/chat.service';
import type { AgentRunsService } from '../agent-runs/agent-runs.service';
import type { AgenticRagService } from '../../rag/agentic/agentic-rag.service';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export async function retryAgentRunRecord(
  id: string,
  runs: AgentRunsService,
  agenticRag: AgenticRagService,
  chat?: ChatService,
) {
    const run = await runs.get(id);
    if (!['failed', 'cancelled'].includes(run.status)) {
      throw new BadRequestException(
        `只有失败或已取消的运行可以重跑，当前状态：${run.status}`,
      );
    }
    if (!['auto', 'agentic'].includes(run.mode)) {
      throw new BadRequestException(`不支持重跑 ${run.mode} 模式的运行`);
    }
    if (!run.userId) {
      throw new BadRequestException('运行记录缺少用户身份，无法安全重跑');
    }

    // Agentic 检查点按 Thread 保存；只允许重跑该 Thread 最新的一次运行，
    // 再用请求快照中的问题摘要校验检查点，避免拿后续请求的输入重跑旧记录。
    const latestRun = await runs.findLatestByThread(
      run.threadId,
      run.tenantId ?? undefined,
    );
    if (latestRun?.id !== run.id) {
      throw new BadRequestException(
        '该会话已有更新的运行记录，无法安全恢复这次运行',
      );
    }
    const snapshot = await agenticRag.getRunSnapshot(run.threadId);
    if (
      !snapshot.available ||
      snapshot.runtimeRunId !== run.id ||
      !snapshot.query?.trim() ||
      snapshot.route !== 'agentic' ||
      (run.route && run.route !== 'agentic')
    ) {
      throw new BadRequestException(
        '没有可用的 Agentic 检查点和问题，无法重跑这条 Agentic 链路',
      );
    }

    const requestEvent = run.events.find(
      (event) => event.eventType === 'request.snapshot',
    );
    const requestSnapshot = asRecord(requestEvent?.payload);
    if (
      requestSnapshot?.schemaVersion !== 3 ||
      requestSnapshot.threadId !== run.threadId ||
      requestSnapshot.mode !== run.mode
    ) {
      throw new BadRequestException(
        '这条运行的快照缺少可重跑参数，请从原对话重新发起',
      );
    }
    const expectedQueryHash = requestSnapshot?.queryHash;
    const actualQueryHash = createHash('sha256')
      .update(snapshot.query)
      .digest('hex')
      .slice(0, 16);
    if (
      typeof expectedQueryHash !== 'string' ||
      expectedQueryHash !== actualQueryHash
    ) {
      throw new BadRequestException(
        '运行快照中找不到匹配的问题，无法安全重跑',
      );
    }

    if (
      typeof requestSnapshot.approvalRequired !== 'boolean' ||
      typeof requestSnapshot.useLongTermMemory !== 'boolean' ||
      typeof requestSnapshot.hasSupplementalEvidence !== 'boolean' ||
      typeof requestSnapshot.trustedAdminPrincipal !== 'boolean' ||
      !Array.isArray(requestSnapshot.departmentIds) ||
      !requestSnapshot.departmentIds.every(
        (departmentId) => typeof departmentId === 'string',
      )
    ) {
      throw new BadRequestException('运行快照缺少必要执行参数，无法安全重跑');
    }
    if (requestSnapshot.hasSupplementalEvidence) {
      throw new BadRequestException(
        '这次运行使用了未保存的附件内容，无法安全重跑',
      );
    }

    const rawScope = requestSnapshot.scope;
    const scopeRecord = rawScope === null ? undefined : asRecord(rawScope);
    if (rawScope !== null && !scopeRecord) {
      throw new BadRequestException('运行快照中的资料范围格式无效，无法重跑');
    }
    const scope = scopeRecord as RetrievalScopeDto | undefined;
    const knowledgeBaseKey = requestSnapshot.knowledgeBaseKey;
    if (
      knowledgeBaseKey !== null &&
      knowledgeBaseKey !== undefined &&
      typeof knowledgeBaseKey !== 'string'
    ) {
      throw new BadRequestException('运行快照中的知识库配置无效，无法重跑');
    }
    const rolePresetId = requestSnapshot.rolePresetId;
    if (
      rolePresetId !== null &&
      rolePresetId !== undefined &&
      typeof rolePresetId !== 'string'
    ) {
      throw new BadRequestException('运行快照中的岗位角色无效，无法重跑');
    }
    const model = requestSnapshot.model;
    if (
      model !== null &&
      model !== undefined &&
      typeof model !== 'string'
    ) {
      throw new BadRequestException('运行快照中的模型配置无效，无法重跑');
    }
    const pluginKeys = requestSnapshot.pluginKeys;
    if (
      !Array.isArray(pluginKeys) ||
      !pluginKeys.every((key) => typeof key === 'string')
    ) {
      throw new BadRequestException('运行快照中的插件配置无效，无法重跑');
    }
    if (!chat) {
      throw new BadRequestException('问答执行服务未就绪，无法重跑');
    }
    const result = await chat.chat(
      {
        query: snapshot.query,
        threadId: run.threadId,
        mode: 'agentic',
        rolePresetId: typeof rolePresetId === 'string' ? rolePresetId : undefined,
        knowledgeBaseKey:
          typeof knowledgeBaseKey === 'string' ? knowledgeBaseKey : undefined,
        scope,
        pluginKeys: pluginKeys as string[],
        approvalRequired: requestSnapshot.approvalRequired,
        useLongTermMemory: requestSnapshot.useLongTermMemory,
      },
      run.userId,
      undefined,
      {
        tenantId: run.tenantId ?? undefined,
        model: typeof model === 'string' ? model : undefined,
        forceAgentic: true,
        trustedAdminPrincipal: requestSnapshot.trustedAdminPrincipal,
        departmentIds: requestSnapshot.departmentIds as string[],
      },
    );
    if (!result.runId) {
      throw new BadRequestException('Agentic 重跑未创建新的运行记录');
    }
    return {
      previousRunId: run.id,
      runId: result.runId,
      threadId: result.threadId,
      status: result.executionState?.paused ? 'waiting_approval' : 'completed',
      route: result.route,
    };
  }
