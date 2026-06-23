import { Controller, Get } from '@nestjs/common';
import { RequireLogin } from './common/decorators/require-login.decorator';
import { isDatabaseEnabled, isRedisEnabled } from './config/runtime';

@Controller()
export class AppController {
  @Get()
  @RequireLogin(false)
  index() {
    return {
      message: 'Welcome to Admin Backend API',
      swagger: '/api',
      health: '/health',
      metrics: '/metrics',
    };
  }

  @Get('health')
  @RequireLogin(false)
  health() {
    return {
      status: 'ok',
      service: 'admin-backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mode: {
        database: isDatabaseEnabled(),
        redis: isRedisEnabled(),
      },
    };
  }
}
