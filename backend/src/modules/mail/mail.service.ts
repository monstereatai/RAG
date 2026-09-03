import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { SendMailParams, SendMailResult } from './dto/mail.dto';

/**
 * 邮件服务
 *
 * 两种工作模式（对齐 admin-backend 企业微信通知的「未配置 → 本地模拟」约定）：
 *  1. 真实发送：MAIL_HOST / MAIL_PORT / MAIL_USER / MAIL_PASS 全部配置时，
 *     通过 nodemailer SMTP 发送；
 *  2. 本地模拟：任一项未配置时「不报错、不阻塞业务」，把完整邮件内容
 *     （收件人 / 主题 / 正文 / 时间）覆盖写入 workspace/mail-outbox/latest.json，
 *     并追加到同目录 outbox.jsonl 留存历史，同时输出日志。
 *     这是本地开发与面试演示的关键设计：无需真实邮箱即可跑通激活 / 找回密码闭环。
 *
 * 测试可通过 RAG_MAIL_OUTBOX_DIR 把模拟邮件目录指到临时路径。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /** 模拟模式邮件目录（默认 workspace/mail-outbox） */
  private readonly outboxDir: string;
  /** SMTP transporter 懒加载缓存（仅在真实模式下创建） */
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    const uploadDir =
      this.configService.get<string>('workspace.uploadDir') ??
      resolve(process.cwd(), '../workspace/uploads');
    this.outboxDir =
      process.env.RAG_MAIL_OUTBOX_DIR ??
      resolve(dirname(uploadDir), 'mail-outbox');
  }

  /** SMTP 是否已配置（决定真实发送 / 本地模拟） */
  get smtpConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('MAIL_HOST') &&
      this.configService.get<string>('MAIL_PORT') &&
      this.configService.get<string>('MAIL_USER') &&
      this.configService.get<string>('MAIL_PASS'),
    );
  }

  /**
   * 发送邮件统一入口
   *
   * @throws 真实模式下 SMTP 发送失败会抛出（调用方决定是否中断业务流程）；
   *         模拟模式不会抛错，保证本地流程畅通。
   */
  async sendMail(params: SendMailParams): Promise<SendMailResult> {
    if (!this.smtpConfigured) {
      return this.simulate(params);
    }
    return this.sendViaSmtp(params);
  }

  /** 真实 SMTP 发送 */
  private async sendViaSmtp(params: SendMailParams): Promise<SendMailResult> {
    // @types/nodemailer 8.x 对 nodemailer 9 的 SentMessageInfo 缺少精确类型，此处显式收窄
    const info = (await this.getTransporter().sendMail({
      from: this.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    })) as { messageId?: string };
    this.logger.log(
      `SMTP mail sent: to=${params.to} subject=${params.subject} messageId=${info.messageId}`,
    );
    return { sent: true, simulated: false, messageId: info.messageId };
  }

  /**
   * 本地模拟发送：完整邮件内容覆盖写入 latest.json + 追加 outbox.jsonl
   * （仿企业微信通知 `[simulated]` 日志模式）
   */
  private async simulate(params: SendMailParams): Promise<SendMailResult> {
    const record = {
      mode: 'simulated',
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text ?? null,
      sentAt: new Date().toISOString(),
      reason: 'MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS 未配置，本地模拟发送',
    };
    const latestPath = join(this.outboxDir, 'latest.json');
    const historyPath = join(this.outboxDir, 'outbox.jsonl');

    await mkdir(this.outboxDir, { recursive: true });
    await writeFile(latestPath, `${JSON.stringify(record, null, 2)}\n`);
    await appendFile(historyPath, `${JSON.stringify(record)}\n`);

    this.logger.log(
      `[simulated] mail -> to=${params.to} subject=${params.subject}（已写入 ${latestPath}）`,
    );
    return {
      sent: false,
      simulated: true,
      reason: 'smtp_not_configured',
      outboxPath: latestPath,
    };
  }

  /** SMTP transporter 懒加载（首次真实发送时创建并复用） */
  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = parseInt(
        this.configService.get<string>('MAIL_PORT') ?? '465',
        10,
      );
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('MAIL_HOST'),
        port,
        // 465 端口走隐式 TLS，其余（如 587）由 nodemailer 协商 STARTTLS
        secure: port === 465,
        auth: {
          user: this.configService.get<string>('MAIL_USER'),
          pass: this.configService.get<string>('MAIL_PASS'),
        },
      });
    }
    return this.transporter;
  }

  /** 发件人：MAIL_FROM 未配置时回落 MAIL_USER */
  private get from(): string {
    return (
      this.configService.get<string>('MAIL_FROM') ||
      this.configService.get<string>('MAIL_USER') ||
      ''
    );
  }
}
