import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../../queue/queue.service';
import { CacheService } from '../cache/cache.service';
import { NotifyGateway } from './notify.gateway';

export interface NotificationData {
  to: string;
  subject?: string;
  message: string;
  template?: string;
  data?: Record<string, any>;
}

export interface EnterpriseWechatMarkdownNotification {
  content: string;
  mentionedList?: string[];
  mentionedMobileList?: string[];
}

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    private readonly cacheService: CacheService,
    private readonly notifyGateway: NotifyGateway,
  ) {}

  async sendVerificationCode(email: string): Promise<{ message: string }> {
    // 1. Generate 6 digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 2. Save to cache (valid for 5 minutes)
    await this.cacheService.set(`verify_code_${email}`, code, 300);

    // 3. Dispatch to Queue
    this.logger.log(`Dispatching email code task to queue for ${email}`);
    await this.queueService.addJob('notification', {
      type: 'email_code',
      payload: { to: email, code },
    });

    return { message: 'Verification code dispatched successfully' };
  }

  async sendEmail(notification: NotificationData): Promise<void> {
    this.logger.log('Dispatching generic email to queue:', notification);
    await this.queueService.addJob('notification', {
      type: 'generic_email',
      payload: notification,
    });
  }

  async sendSMS(phoneNumber: string, message: string): Promise<void> {
    this.logger.log('Sending SMS to', phoneNumber, ':', message);
    // TODO: Implement SMS service integration
  }

  /**
   * 企业微信机器人通知入口。
   *
   * 配置 WECHAT_WORK_WEBHOOK_URL 后会调用企业微信机器人 Markdown API；
   * 未配置时保留本地模拟行为，方便开发、测试和面试演示，不阻塞业务流程。
   * 生产环境应通过密钥注入配置 Webhook，不要把地址写进代码或提交到仓库。
   */
  async sendEnterpriseWechatMarkdown(
    notification: EnterpriseWechatMarkdownNotification,
  ): Promise<{ sent: boolean; simulated: boolean; reason?: string }> {
    const webhookUrl = this.configService.get<string>('WECHAT_WORK_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.log(
        `[simulated] Enterprise WeChat notification: ${notification.content.slice(0, 120)}`,
      );
      return { sent: false, simulated: true, reason: 'webhook_not_configured' };
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: notification.content,
          mentioned_list: notification.mentionedList,
          mentioned_mobile_list: notification.mentionedMobileList,
        },
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { errcode?: number; errmsg?: string }
      | null;
    if (!response.ok || payload?.errcode !== 0) {
      throw new Error(
        `Enterprise WeChat notification failed: ${payload?.errmsg ?? response.statusText}`,
      );
    }

    return { sent: true, simulated: false };
  }

  /**
   * 运营告警统一入口：事故、恢复、成本超预算和 SLA 告警都从这里调用，
   * 后续可在此扩展飞书、钉钉、PagerDuty 等通知渠道。
   */
  async sendOperationsAlert(params: {
    title: string;
    severity: 'info' | 'warning' | 'critical';
    summary: string;
    traceId?: string;
    incidentId?: string;
  }): Promise<{ sent: boolean; simulated: boolean; reason?: string }> {
    const lines = [
      `### ${params.title}`,
      `> 级别：${params.severity}`,
      `> 摘要：${params.summary}`,
      params.traceId ? `> Trace ID：${params.traceId}` : '',
      params.incidentId ? `> Incident：${params.incidentId}` : '',
    ].filter(Boolean);

    return this.sendEnterpriseWechatMarkdown({ content: lines.join('\n') });
  }

  async sendPushNotification(userId: number, title: string, body: string): Promise<void> {
    this.logger.log('Sending push notification to user', userId, ':', title, '-', body);
    this.notifyGateway.sendToUser(userId.toString(), 'push_notification', { title, body });
  }

  async sendOrderNotification(orderId: number, type: 'created' | 'updated' | 'cancelled'): Promise<void> {
    const message = `Order ${type}: Order #${orderId}`;
    this.logger.log('Sending order notification:', message);
    this.notifyGateway.sendToAll('order_update', { orderId, type, message });
  }

  async sendPaymentNotification(paymentId: number, status: string): Promise<void> {
    const message = `Payment status updated: Payment #${paymentId} - ${status}`;
    this.logger.log('Sending payment notification:', message);
    this.notifyGateway.sendToAll('payment_update', { paymentId, status, message });
  }
}
