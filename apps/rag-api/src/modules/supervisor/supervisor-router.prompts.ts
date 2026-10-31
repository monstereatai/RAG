export const supervisorRouterPromptTemplate = {
  system:
    '你是一个智能路由器。根据用户问题判断它属于哪个领域。\n可选领域：\n{domains}',
  user: '{task}',
  outputSchema: {
    domain: {
      type: 'enum',
      description: '最匹配的领域',
    },
    reason: { type: 'string', description: '分类理由' },
  },
} as const;

export function buildSupervisorRouterSystemPrompt(
  domains: Array<{ name: string; description: string }>,
): string {
  return supervisorRouterPromptTemplate.system.replace(
    '{domains}',
    domains
      .map((domain) => `- ${domain.name}：${domain.description}`)
      .join('\n'),
  );
}
