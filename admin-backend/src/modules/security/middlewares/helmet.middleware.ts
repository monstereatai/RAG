import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { SecurityService } from '../security.service';

@Injectable()
export class HelmetMiddleware implements NestMiddleware {
  constructor(private readonly securityService: SecurityService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // 应用Helmet中间件
    const helmetInstance = helmet(this.securityService.getHelmetConfig());

    // 创建一个包装器来处理Helmet
    const helmetMiddleware = (req: Request, res: Response, next: NextFunction) => {
      helmetInstance(req, res, next);
    };

    helmetMiddleware(req, res, next);
  }
}
