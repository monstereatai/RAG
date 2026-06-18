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
}
