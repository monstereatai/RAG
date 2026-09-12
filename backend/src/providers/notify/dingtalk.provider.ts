import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

export interface DingTalkApprovalPayload {
  threadId: string;
  projectId: string;
  brief: string;
  completedRoles: string[];
  pendingApprovalRoles: string[];
}

export interface DingTalkRagAnswerPayload {
  threadId?: string;
  query: string;
  answer: string;
  mode: string;
  latencyMs: number;
  citationCount: number;
}

/**
 * 钉钉群机器人通知（加签模式）。
 *
 * 所有通知均为 fire-and-forget：失败只记 warn 日志，不阻塞业务。
 * 告警类通知（notifyAlert）按 key 节流，默认 5 分钟窗口，避免熔断
 * 反复打开时刷屏；审批通知不节流（修订后再次待审批是新事件）。
 */
@Injectable()
export class DingTalkProvider {
  private readonly logger = new Logger(DingTalkProvider.name);
  private readonly webhookUrl: string;
  private readonly secret: string;
  private readonly alertCooldownMs: number;
  private readonly forwardThreadIds: Set<string>;
  private readonly lastAlertAt = new Map<string, number>();
  private lastError: string | null = null;
  private messagesSent = 0;

  constructor(private readonly config: ConfigService) {
    this.webhookUrl = this.config.get<string>('dingtalk.webhookUrl') ?? '';
    this.secret = this.config.get<string>('dingtalk.secret') ?? '';
    this.alertCooldownMs =
      this.config.get<number>('dingtalk.alertCooldownMs') ?? 300_000;
    this.forwardThreadIds = new Set(
      (this.config.get<string>('dingtalk.forwardThreadIds') ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
    if (!this.isEnabled()) {
      this.logger.log('DingTalk notify disabled or missing keys.');
    }
  }

  isEnabled(): boolean {
    return Boolean(this.webhookUrl && this.secret);
  }

  getStatus(): {
    enabled: boolean;
    alertCooldownMs: number;
    forwardThreadIds: string[];
  } {
    return {
      enabled: this.isEnabled(),
      alertCooldownMs: this.alertCooldownMs,
      forwardThreadIds: [...this.forwardThreadIds],
    };
  }

  getHealth(): {
    enabled: boolean;
    healthy: boolean;
    messagesSent: number;
    lastError: string | null;
  } {
    return {
      enabled: this.isEnabled(),
      healthy: this.isEnabled() && !this.lastError,
      messagesSent: this.messagesSent,
      lastError: this.lastError,
    };
  }

  async smoke(): Promise<{
    enabled: boolean;
    sent: boolean;
    reason?: string;
  }> {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        sent: false,
        reason: 'dingtalk_disabled_or_missing_keys',
      };
    }
    const sent = await this.sendMarkdown(
      'RAG 通知冒烟',
      '**[RAG 项目] DingTalk notify smoke**',
    );
    return sent
      ? { enabled: true, sent: true }
      : { enabled: true, sent: false, reason: 'dingtalk_send_failed' };
  }

  /** 审批通知：工作流到达人工审批节点。不节流。 */
  async notifyApproval(payload: DingTalkApprovalPayload): Promise<void> {
    if (!this.isEnabled()) return;
    const text = [
      '## 产研运工作流待审批',
      `- 活动：**${payload.projectId}**`,
      `- threadId：\`${payload.threadId}\``,
      `- 待审批角色：**${payload.pendingApprovalRoles.join('、') || '-'}**`,
      `- 已完成角色：${payload.completedRoles.join('、') || '-'}`,
      `- 需求摘要：${payload.brief.slice(0, 200)}`,
    ].join('\n\n');
    await this.sendMarkdown('工作流待审批', text);
  }

  /** 告警通知：按 key 节流（默认 5 分钟窗口内同 key 只发一次）。 */
  async notifyAlert(key: string, text: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const now = Date.now();
    const last = this.lastAlertAt.get(key) ?? 0;
    if (now - last < this.alertCooldownMs) return false;
    this.lastAlertAt.set(key, now);
    return this.sendMarkdown(`告警 ${key}`, text);
  }

  /** 问答推送：仅转发 threadId 在白名单内的会话。 */
  async forwardRagAnswer(payload: DingTalkRagAnswerPayload): Promise<void> {
    if (!this.isEnabled()) return;
    if (!payload.threadId || !this.forwardThreadIds.has(payload.threadId)) {
      return;
    }
    const text = [
      `## RAG 回答转发（${payload.mode}）`,
      `- 问题：${payload.query.slice(0, 300)}`,
      `- 回答：${payload.answer.slice(0, 1800)}`,
      `- 耗时：${payload.latencyMs}ms ｜ 引用：${payload.citationCount} 条`,
    ].join('\n\n');
    await this.sendMarkdown('RAG 回答转发', text);
  }

  /**
   * 钉钉加签：secret 作为 HMAC key，`timestamp+"\n"+secret` 作为消息
   * （官方 Python 示例算法，已实测；文档文字描述的 Java 版不匹配）。
   */
  private sign(timestamp: number, secret: string): string {
    const hmac = createHmac('sha256', secret)
      .update(`${timestamp}\n${secret}`)
      .digest('base64');
    return encodeURIComponent(hmac);
  }

  private buildUrl(): string {
    const timestamp = Date.now();
    const sign = this.sign(timestamp, this.secret);
    return `${this.webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
  }

  private async post(body: unknown): Promise<boolean> {
    try {
      const response = await fetch(this.buildUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      const result = (await response.json()) as {
        errcode: number;
        errmsg?: string;
      };
      if (!response.ok || result.errcode !== 0) {
        throw new Error(
          `dingtalk HTTP ${response.status} errcode=${result.errcode} ${result.errmsg ?? ''}`,
        );
      }
      this.messagesSent += 1;
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = (error as Error).message;
      this.logger.warn(`DingTalk notify failed: ${(error as Error).message}`);
      return false;
    }
  }

  private sendMarkdown(title: string, text: string): Promise<boolean> {
    return this.post({
      msgtype: 'markdown',
      markdown: { title, text },
    });
  }
}
