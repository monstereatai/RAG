export interface PromptInjectionFinding {
  pattern: string;
  severity: 'low' | 'medium' | 'high';
  excerpt: string;
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
    pattern: /(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(system|developer|admin|root)/i,
  },
  {
    name: 'tool_override',
    severity: 'medium',
    pattern: /(call|invoke|execute|run)\s+(any\s+)?tool\s+without\s+(approval|permission|validation)/i,
  },
  {
    name: 'destructive_document_operation',
    severity: 'high',
    pattern: /(?:delete|remove|destroy|erase)\s+(?:all|every|the\s+entire)?\s*(?:documents?|files?|knowledge\s*base)/i,
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
    pattern: /(泄露|输出|展示|打印).{0,16}(系统提示词|开发者提示词|密钥|token|密码)/i,
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
