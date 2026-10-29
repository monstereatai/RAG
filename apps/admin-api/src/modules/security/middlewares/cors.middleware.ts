import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SecurityService } from '../security.service';

@Injectable()
export class CorsMiddleware implements NestMiddleware {
  constructor(private readonly securityService: SecurityService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const corsConfig = this.securityService.getCorsConfig();

    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', corsConfig.origin.join(', '));
    res.setHeader('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', corsConfig.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Allow-Credentials', corsConfig.credentials.toString());
    res.setHeader('Access-Control-Max-Age', corsConfig.maxAge.toString());

    // 处理预检请求
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // 继续处理其他请求
    next();
  }
}