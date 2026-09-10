import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET?.trim();
    if (process.env.NODE_ENV === 'production' && !secret) {
      throw new Error('JWT_SECRET is required when NODE_ENV=production');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret || 'change-me-in-production-min-32-chars',
    });
  }

  async validate(payload: { sub: number; username: string; role: string; permissions?: string[] }) {
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions ?? [],
    };
  }
}
