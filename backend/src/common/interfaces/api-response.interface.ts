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
