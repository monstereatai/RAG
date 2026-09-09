/** 将 RAG 后端的统一信封转换为管理端对外的单层响应。 */
export function unwrapRagResponse<T>(value: T): T {
  if (value && typeof value === 'object' && 'data' in (value as object)) {
    return (value as T & { data: T }).data;
  }
  return value;
}
