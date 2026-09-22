/**
 * 审计／观测出口的最小脱敏规则。
 *
 * 这不是业务内容脱敏器，只负责阻断最容易误入日志或第三方追踪系统的
 * 凭据、联系方式和长编号。原始会话内容仍应按租户的数据分级策略单独治理。
 */
export function redactAuditText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[phone]')
    .replace(
      /\b(?:Bearer|Token|API[-_ ]?Key|Secret|Password)\s+[A-Za-z0-9._~+/=-]+/gi,
      '[credential]',
    )
    .replace(/\b\d{12,}\b/g, '[long-number]');
}

export function redactAuditValue(value: unknown): unknown {
  if (typeof value === 'string') return redactAuditText(value);
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactAuditValue(item),
      ]),
    );
  }
  return value;
}
