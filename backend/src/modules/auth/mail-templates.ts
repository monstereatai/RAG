/**
 * 认证邮件模板（激活 / 密码重置）
 *
 * 保持极简内联样式，避免依赖外部模板引擎；
 * 文案与品牌名与项目保持一致（企业知识库 RAG）。
 */

/** 基础容器样式 */
const WRAP_STYLE = [
  'max-width:560px;margin:0 auto;padding:24px;',
  'font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;',
  'color:#1f2329;',
].join('');

/** 生成邮箱激活邮件 HTML（含一次性激活链接，24h 内有效） */
export function buildActivationEmailHtml(
  username: string,
  verifyUrl: string,
): string {
  return `
<div style="${WRAP_STYLE}">
  <h2 style="margin:0 0 16px;">企业知识库 · 邮箱激活</h2>
  <p>你好，<strong>${escapeHtml(username)}</strong>！感谢注册企业知识库平台。</p>
  <p>请点击下方按钮完成邮箱激活（链接 24 小时内有效）：</p>
  <p style="margin:24px 0;">
    <a href="${verifyUrl}"
       style="display:inline-block;padding:10px 24px;background:#2563eb;color:#fff;
              border-radius:6px;text-decoration:none;font-weight:600;">
      激活邮箱
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;">
    若按钮无法点击，请复制以下链接到浏览器打开：<br />
    <a href="${verifyUrl}">${verifyUrl}</a>
  </p>
  <p style="color:#9ca3af;font-size:12px;">如非本人操作，请忽略本邮件。</p>
</div>`.trim();
}

/** 生成密码重置验证码邮件 HTML（6 位数字，10 分钟内有效） */
export function buildPasswordResetCodeHtml(code: string): string {
  return `
<div style="${WRAP_STYLE}">
  <h2 style="margin:0 0 16px;">企业知识库 · 密码重置</h2>
  <p>您正在重置登录密码，验证码如下（10 分钟内有效）：</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:8px;margin:20px 0;">
    ${escapeHtml(code)}
  </p>
  <p style="color:#9ca3af;font-size:12px;">如非本人操作，请忽略本邮件，您的账户不会受影响。</p>
</div>`.trim();
}

/** 防 HTML 注入：用户名等外部输入统一转义 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
