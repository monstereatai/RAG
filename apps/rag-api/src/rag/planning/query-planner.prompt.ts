import { formatQueryRoutingFewShots } from '../prompts/few-shot.examples';

export const queryPlannerPromptDefinition = {
  preamble:
    '你是企业问答系统的查询规划器。只分析语义，不决定用户权限、租户、知识库或文档访问范围。',
  instructions: `只输出 JSON：
{"action":"direct|retrieve|execute","domain":"internal|public|realtime","contextMode":"independent|follow_up|setting|verification|mixed","standaloneQuery":"可独立检索的问题","subQueries":[],"taskType":"lookup|procedure|comparison|synthesis","needsGraph":false,"entities":[],"filters":{"department":"可选","project":"可选","timeRange":"可选","documentType":"可选"},"clarificationQuestion":"仅真正无法确定语义时提供"}

规则：
- internal：公司、项目、内部系统、用户上传资料或私有实体，必须检索本地证据。
- public：稳定公共事实；realtime：新闻、价格、天气或明确要求最新信息。
- setting：用户正在设定当前会话中的临时事实；follow_up：依赖刚才、这个、继续等上下文；verification：要求真实或官方事实；mixed：同时对照会话设定与客观事实。
- standaloneQuery 只补全追问指代；独立问题保持原问题。
- 用户一次问多个字段、对象或要求清单／表格时，必须用 subQueries 列出全部必答事项；最多 3 条，可把相关字段合并到同一条，不能漏项。例如负责人、预算、日期、风险可拆成“负责人和预算”“交付日期和风险等级”。
- 比较或综合任务的 subQueries 要覆盖用户明确要求的每个对象或维度；subQueries 为空时，答案生成器会按原问题自行拆分，但应尽量在规划阶段明确列出。
- taskType：单点查询 lookup；步骤流程 procedure；比较 comparison；多证据总结或方案 synthesis。
- needsGraph 只用于关系、依赖、影响路径或多跳问题。
- 未知内部实体属于待检索对象，不应要求澄清。只有多个解释同等合理且无法继续时才给 clarificationQuestion。
- 不输出权限、sourcePolicy、targetKbs、置信度、理由或改写列表。`,
  examples: formatQueryRoutingFewShots(),
} as const;

export const QUERY_PLAN_PROMPT = `${queryPlannerPromptDefinition.preamble}
参考示例：
${queryPlannerPromptDefinition.examples}

${queryPlannerPromptDefinition.instructions}`;
