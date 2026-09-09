export interface PromptInjectionFinding {
  pattern: string;
  severity: 'low' | 'medium' | 'high';
  excerpt: string;
}

export interface DangerousQueryFinding {
  pattern: string;
  excerpt: string;
}

export interface SafetyPolicyDescriptor {
  id: string;
  version: number;
  category: 'destructive_operation' | 'secret_exfiltration' | 'prompt_injection';
  action: 'block';
  enabled: boolean;
  effectiveAt: string;
  description: string;
}

const SAFETY_POLICY_EFFECTIVE_AT = '2026-09-09T00:00:00.000Z';

const policy = (
  input: Omit<SafetyPolicyDescriptor, 'version' | 'enabled' | 'effectiveAt'>,
): SafetyPolicyDescriptor => ({
  ...input,
  version: 1,
  enabled: true,
  effectiveAt: SAFETY_POLICY_EFFECTIVE_AT,
});

const dangerousQueryPatterns: Array<{
  name: string;
  pattern: RegExp;
}> = [
  {
    name: 'database_destructive_operation',
    pattern:
      /(?:drop\s+(?:database|schema|table)|truncate\s+(?:table|database|schema)|delete\s+from|alter\s+table.{0,80}\bdrop\b|(?:删库|删除|清空|销毁).{0,16}(?:数据库|db|schema|表|数据表))/i,
  },
  {
    name: 'destructive_shell_operation',
    pattern:
      /(?:rm\s+-rf|mkfs(?:\.[a-z0-9]+)?|format\s+[a-z]:|dd\s+if=|shutdown\s+-?h|reboot\b|删除所有文件|清空所有文件)/i,
  },
  {
    name: 'secret_exfiltration',
    pattern:
      /(?:泄露|输出|打印|导出|展示|读取).{0,16}(?:密钥|api\s*key|token|密码|secret|凭据)/i,
  },
];

const safetyDiscussionMarkers =
  /(?:什么是|是什么意思|原理|如何防止|如何防范|如何检测|如何审计|安全测试|风险分析|防护方案|检测规则|示例说明)/i;

const actionIntentMarkers =
  /(?:帮我|请执行|执行|运行|直接|操作|导出|打印|泄露|执行一下|run|execute|perform)/i;

export function listSafetyPolicies(): SafetyPolicyDescriptor[] {
  return [
    policy({
      id: 'database_destructive_operation',
      category: 'destructive_operation',
      action: 'block',
      description: '阻止 DROP、TRUNCATE、DELETE FROM、删库和删表等破坏性数据库请求。',
    }),
    policy({
      id: 'destructive_shell_operation',
      category: 'destructive_operation',
      action: 'block',
      description: '阻止 rm -rf、mkfs、format、dd、关机和批量删除文件等危险命令。',
    }),
    policy({
      id: 'secret_exfiltration',
      category: 'secret_exfiltration',
      action: 'block',
      description: '阻止导出、打印、展示 API Key、Token、密码和凭据等敏感信息。',
    }),
    policy({
      id: 'prompt_injection_high_risk',
      category: 'prompt_injection',
      action: 'block',
      description: '阻止覆盖系统规则、越权调用工具和索取系统提示词等高风险注入。',
    }),
  ];
}

/**
 * 检测用户问题中的破坏性操作意图。仅拦截带有执行意图的请求，
 * 允许「什么是 DROP TABLE」「如何防止删库」等安全讨论继续进入 RAG。
 */
export function detectDangerousQuery(query: string): DangerousQueryFinding[] {
  if (!query?.trim()) return [];
  const normalized = query.replace(/[\u200b\u200c\u200d]/g, '').trim();
  const discussionOnly =
    safetyDiscussionMarkers.test(normalized) &&
    !actionIntentMarkers.test(normalized.replace(safetyDiscussionMarkers, ''));
  if (discussionOnly) return [];

  return dangerousQueryPatterns.flatMap((item) => {
    const match = item.pattern.exec(normalized);
    return match
      ? [{ pattern: item.name, excerpt: compactExcerpt(normalized, match.index) }]
      : [];
  });
}

/**
 * 面向「不可信输入」的规则型第一道防线。它不决定模型回答内容：高风险命中由入库链路隔离，
 * 中风险仅形成质量告警；生成前再由 sanitizeUntrustedContext 清理已检索到的可疑指令。
 */
const injectionPatterns: Array<{
  name: string;
  severity: PromptInjectionFinding['severity'];
  pattern: RegExp;
}> = [
  {
    name: 'ignore_previous_instructions',
    severity: 'high',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  },
  {
    name: 'system_prompt_exfiltration',
    severity: 'high',
    pattern: /(reveal|print|show|dump)\s+(the\s+)?(system|developer)\s+prompt/i,
  },
  {
    name: 'role_override',
    severity: 'high',
    pattern:
      /(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(system|developer|admin|root)/i,
  },
  {
    name: 'tool_override',
    severity: 'medium',
    pattern:
      /(call|invoke|execute|run)\s+(any\s+)?tool\s+without\s+(approval|permission|validation)/i,
  },
  {
    name: 'destructive_document_operation',
    severity: 'high',
    pattern:
      /(?:delete|remove|destroy|erase)\s+(?:all|every|the\s+entire)?\s*(?:documents?|files?|knowledge\s*base)/i,
  },
  {
    name: 'chinese_ignore_instructions',
    severity: 'high',
    pattern: /(忽略|无视|覆盖).{0,12}(之前|以上|上面).{0,12}(指令|规则|要求)/,
  },
  {
    name: 'chinese_role_override',
    severity: 'high',
    pattern: /(你现在是|请扮演|切换为).{0,12}(系统|开发者|管理员|root)/i,
  },
  {
    name: 'chinese_secret_exfiltration',
    severity: 'high',
    pattern:
      /(泄露|输出|展示|打印).{0,16}(系统提示词|开发者提示词|密钥|token|密码)/i,
  },
  {
    name: 'chinese_destructive_document_operation',
    severity: 'high',
    pattern: /(删除|清空|销毁).{0,12}(全部|所有).{0,12}(文档|文件|知识库)/,
  },
];

/**
 * 返回可审计命中，而不是直接修改原文；调用方据 severity 决定隔离、告警或继续处理。
 */
export function detectPromptInjection(text: string): PromptInjectionFinding[] {
  const findings: PromptInjectionFinding[] = [];

  for (const item of injectionPatterns) {
    const match = item.pattern.exec(text);
    if (!match) continue;
    findings.push({
      pattern: item.name,
      severity: item.severity,
      excerpt: compactExcerpt(text, match.index),
    });
  }

  return findings;
}

/**
 * 生成前逐行移除高风险指令，保留替换标记让模型知道资料存在缺口；
 * 绝不执行文本中的工具调用、删除或角色切换要求。
 */
export function sanitizeUntrustedContext(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line) => {
      const findings = detectPromptInjection(line);
      if (findings.some((finding) => finding.severity === 'high')) {
        return `[已移除疑似提示注入指令：${findings
          .filter((finding) => finding.severity === 'high')
          .map((finding) => finding.pattern)
          .join('、')}]`;
      }
      return line;
    })
    .join('\n');
}

function compactExcerpt(text: string, index: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + 120);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}
