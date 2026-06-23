import { Injectable, NestMiddleware, OnModuleDestroy } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SecurityService } from '../security.service';

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware, OnModuleDestroy {
  private ipRequests: Map<string, { count: number; resetTime: number }> = new Map();
  private readonly cleanupInterval?: NodeJS.Timeout;

  constructor(private readonly securityService: SecurityService) {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // 每分钟清理一次过期的请求记录
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, 60000);
    this.cleanupInterval.unref?.();
  }

  use(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const rateLimitConfig = this.securityService.getRateLimitConfig();
    const windowMs = rateLimitConfig.windowMs;

    // 清理过期的请求记录
    this.cleanupExpiredRequests();

    // 获取或创建该IP的请求记录
    let ipRequest = this.ipRequests.get(ip);
    if (!ipRequest) {
      ipRequest = {
        count: 1,
        resetTime: now + windowMs,
      };
      this.ipRequests.set(ip, ipRequest);
      return next();
    }

    // 检查是否超过了请求限制
    if (now > ipRequest.resetTime) {
      // 重置计数器
      ipRequest.count = 1;
      ipRequest.resetTime = now + windowMs;
      return next();
    }

    // 检查请求数是否超过限制
    if (ipRequest.count >= rateLimitConfig.max) {
      // 记录安全事件
      this.securityService.logSecurityEvent({
        type: 'RATE_LIMIT',
        ip,
        userAgent: req.get('user-agent') || 'Unknown',
        action: req.method,
        details: {
          url: req.url,
          currentCount: ipRequest.count,
          maxRequests: rateLimitConfig.max,
          timestamp: new Date().toISOString(),
        },
      });

      return res.status(429).json({
        statusCode: 429,
        message: rateLimitConfig.message,
        error: 'Too Many Requests',
      });
    }

    // 增加计数器
    ipRequest.count++;

    // 设置剩余时间头
    const remaining = Math.max(0, Math.ceil((ipRequest.resetTime - now) / 1000));
    res.setHeader('X-RateLimit-Remaining', (rateLimitConfig.max - ipRequest.count).toString());
    res.setHeader('X-RateLimit-Reset', ipRequest.resetTime.toString());
    res.setHeader('Retry-After', remaining.toString());

    next();
  }

  private cleanupExpiredRequests() {
    const now = Date.now();
    for (const [ip, request] of this.ipRequests.entries()) {
      if (now > request.resetTime) {
        this.ipRequests.delete(ip);
      }
    }
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
