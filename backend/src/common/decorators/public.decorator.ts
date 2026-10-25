import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/**
 * 标记无需 JWT 的 HTTP 接口。
 * 全局 JwtAuthGuard 默认保护所有 HTTP 路由，只有显式 @Public() 的接口才放行。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
