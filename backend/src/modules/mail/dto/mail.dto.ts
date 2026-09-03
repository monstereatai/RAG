/**
 * 邮件发送入参与结果结构
 *
 * MailService 是业务侧唯一的邮件出口（激活邮件、验证码邮件等），
 * 真实发送走 SMTP，未配置时进入本地模拟模式（见 mail.service.ts）。
 */

/** 发送邮件入参 */
export interface SendMailParams {
  /** 收件人邮箱 */
  to: string;
  /** 邮件主题 */
  subject: string;
  /** HTML 正文 */
  html: string;
  /** 纯文本正文（可选，缺省时由客户端从 HTML 渲染） */
  text?: string;
}

/** 发送邮件结果 */
export interface SendMailResult {
  /** 邮件是否已被投递（模拟模式下为 false，但业务流程不因此失败） */
  sent: boolean;
  /** 是否为本地模拟发送 */
  simulated: boolean;
  /** 未真实发送的原因 */
  reason?: 'smtp_not_configured' | 'send_failed';
  /** SMTP 返回的 messageId（真实发送时存在） */
  messageId?: string;
  /** 模拟模式下邮件内容落盘路径（真实发送时为空） */
  outboxPath?: string;
}
