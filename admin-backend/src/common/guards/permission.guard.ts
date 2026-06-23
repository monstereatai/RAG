import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  @Inject(Reflector)
  private reflector: Reflector;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSION_KEY,
      [context.getClass(), context.getHandler()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    if (!(request as any).user) {
      throw new UnauthorizedException('用户未登录');
    }

    // In a real application, you'd fetch user's permissions here or populate them in LoginGuard.
    // For now, we assume user.permissions is populated.
    const permissions: string[] = (request as any).user.permissions || [];

    for (const requiredPermission of requiredPermissions) {
      if (!permissions.includes(requiredPermission)) {
        throw new UnauthorizedException('您没有访问该接口的权限');
      }
    }

    return true;
  }
}
