import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../interfaces/api-response.interface';

/**
 * 从请求中提取当前登录用户（由 AuthGuard 注入到 request.user）
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<{
      user?: JwtPayload;
    }>();
    return request.user;
  },
);
