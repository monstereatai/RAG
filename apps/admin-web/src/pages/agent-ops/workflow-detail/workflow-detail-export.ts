export const buildHandoffFiles = (
  handoff: Record<string, unknown>,
  projectId?: string,
) => {
  const context =
    handoff.context &&
    typeof handoff.context === 'object' &&
    !Array.isArray(handoff.context)
      ? (handoff.context as Record<string, unknown>)
      : handoff;
  const stages = Array.isArray(context.stages)
    ? (context.stages as Array<Record<string, unknown>>)
    : [];
  const schemas = Array.isArray(handoff.schemas)
    ? (handoff.schemas as Array<Record<string, unknown>>)
    : stages.flatMap((stage) =>
        Array.isArray(stage.lowCodeSchemas) ? stage.lowCodeSchemas : [],
      );
  const evidence: Array<Record<string, unknown>> = Array.isArray(
    handoff.citations,
  )
    ? (handoff.citations as Array<Record<string, unknown>>)
    : stages.flatMap((stage) =>
        (Array.isArray(stage.evidence) ? stage.evidence : []).map((item) => ({
          role: stage.role,
          ...(item as Record<string, unknown>),
        })),
      );
  const files: Array<{ name: string; content: string }> = [
    {
      name: 'RAG_WORKFLOW_CONTEXT.json',
      content: `${JSON.stringify(context, null, 2)}\n`,
    },
    {
      name: 'HANDOFF_MANIFEST.json',
      content: `${JSON.stringify(handoff.manifest ?? handoff, null, 2)}\n`,
    },
    {
      name: 'LOW_CODE_SCHEMAS.json',
      content: `${JSON.stringify(schemas, null, 2)}\n`,
    },
    {
      name: 'RAG_EVIDENCE.json',
      content: `${JSON.stringify(evidence, null, 2)}\n`,
    },
    {
      name: 'README.md',
      content: `# ${projectId ?? '产研运项目'} 产研运交接物\n\n本目录由已完成的产研运工作流导出，供 Codex、Claude、Cursor 等 AI Coding 工具使用。先阅读 \`HANDOFF.md\`，结构化 Schema 在 \`LOW_CODE_SCHEMAS.json\` 与 \`schemas/\`，RAG 引用证据在 \`RAG_EVIDENCE.md\`。\n`,
    },
    {
      name: 'RAG_EVIDENCE.md',
      content: [
        '# RAG 引用证据',
        evidence.length > 0
          ? evidence
              .map(
                (item) =>
                  `- [${String(item.role ?? 'unknown')}] ${String(item.id ?? 'unknown')}：文档 ${String(item.docId ?? 'unknown')}／片段 ${String(item.chunkIndex ?? 'unknown')}／评分 ${String(item.totalScore ?? 'unknown')}\n  - ${String(item.excerpt ?? '')}`,
              )
              .join('\n')
          : '本次工作流未检索到可引用的 RAG 证据。',
      ].join('\n\n'),
    },
  ];
  const handoffSections: string[] = [];
  stages.forEach((stage) => {
    const role = String(stage.role ?? 'stage');
    const deliverables = Array.isArray(stage.deliverables)
      ? (stage.deliverables as Array<Record<string, unknown>>)
      : [];
    const lowCodeSchemas = Array.isArray(stage.lowCodeSchemas)
      ? stage.lowCodeSchemas
      : [];
    if (lowCodeSchemas.length > 0) {
      files.push({
        name: `schemas/${role}.json`,
        content: `${JSON.stringify(lowCodeSchemas, null, 2)}\n`,
      });
    }
    deliverables.forEach((deliverable, index) => {
      const title = String(deliverable.title ?? `${role}-${index + 1}`).replace(
        /[\\/:*?"<>|]/g,
        '-',
      );
      files.push({
        name: `handoff/${role}/${String(index + 1).padStart(2, '0')}-${title}.md`,
        content: String(deliverable.markdown ?? ''),
      });
      handoffSections.push(
        `## ${role}／${title}\n\n${String(deliverable.markdown ?? '')}`,
      );
    });
  });
  files.push({
    name: 'HANDOFF.md',
    content:
      typeof handoff.markdown === 'string'
        ? handoff.markdown
        : [
            `# ${projectId ?? '产研运项目'} 产研运交接包`,
            '本文件供 AI Coding 工具阅读；结构化 Schema 见 `LOW_CODE_SCHEMAS.json`，RAG 引用证据见 `RAG_EVIDENCE.md`。',
            ...handoffSections,
          ].join('\n\n'),
  });
  return files;
};
