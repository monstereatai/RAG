/**
 * 统一 API 响应格式
 */
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

/**
 * JWT Payload
 */
export class JwtPayload {
  userId!: string;
  username!: string;
  role!: 'admin' | 'user';
  /** 当前请求的认证来源；普通 JWT 省略时按 jwt 处理。 */
  authType?: 'jwt' | 'api-token' | 'service';
  /** API Token 的最小权限集合；普通 JWT 不携带该字段。 */
  scopes?: string[];
  /** 多租户迁移完成前保持可选；新签发 token 应携带该字段。 */
  tenantId?: string;

  /**
   * token 类型：
   * - access：业务访问 token，可通过 JwtAuthGuard 访问业务接口
   * - refresh：刷新 token，仅可用于 POST /auth/refresh 换发新 token，
   *   携带它访问业务接口会被 JwtAuthGuard 以 401 拒绝
   *
   * 兼容说明：双 token 机制上线前签发的旧 token 无该字段，视为 access 放行，
   * 因此声明为可选属性。
   */
  type?: 'access' | 'refresh';
}
