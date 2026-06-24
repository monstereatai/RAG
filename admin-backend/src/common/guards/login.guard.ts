import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { REQUIRE_LOGIN_KEY } from '../decorators/require-login.decorator';

@Injectable()
export class LoginGuard implements CanActivate {
  @Inject(Reflector)
  private reflector: Reflector;

  @Inject(JwtService)
  private jwtService: JwtService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();

    const requireLogin = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_LOGIN_KEY,
      [context.getClass(), context.getHandler()],
    );

    // If requireLogin is explicitly false, allow access.
    // By default, if we register this globally and want everything protected unless specified,
    // we would check if requireLogin === false to skip. 
    // Wait, the standard is: if we don't have the decorator, do we require login? 
    // We will assume routes REQUIRE login by default IF the guard is global. 
    // To make a route public, we must use @RequireLogin(false).
    if (requireLogin === false) {
      return true;
    }

    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('用户未登录');
    }

    try {
      const data = this.jwtService.verify(token);

      (request as any).user = {
        userId: data.sub || data.userId,
        username: data.username,
        role: data.role,
        permissions: data.permissions ?? [],
      };
      return true;
    } catch (e) {
      throw new UnauthorizedException('token 失效，请重新登录');
    }
  }

  private extractToken(request: Request): string | null {
    const authorization = request.headers.authorization;
    if (authorization) {
      const [type, token] = authorization.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    const queryToken = request.query?.token;
    if (typeof queryToken === 'string' && queryToken) {
      return queryToken;
    }

    return null;
  }
}
