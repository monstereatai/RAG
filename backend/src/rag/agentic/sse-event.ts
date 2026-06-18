/**
 * SSE 流式事件类型
 */
export type SseEventType =
  | 'routing' // 路由决策
  | 'query_augment' // 查询扩展
  | 'retrieval' // 检索结果
  | 'sufficiency' // 检索充分性评估
  | 'web_search' // 联网兜底检索
  | 'rerank' // 二次排序
  | 'token' // LLM token 流
  | 'citation' // 引用来源
  | 'reflection' // 反思评估
  | 'final' // 最终结果
  | 'error'; // 错误

export interface SseEvent {
  type: SseEventType;
  data: unknown;
}

/**
 * SSE 事件回调
 */
export type SseCallback = (event: SseEvent) => void;
