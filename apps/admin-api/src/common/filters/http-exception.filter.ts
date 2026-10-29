import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();

    const res = exception.getResponse() as any;
    const message = res?.message?.join ? res?.message?.join(',') : exception.message;

    if (status >= 500) {
      this.logger.error(`[${status}] ${message}`, exception.stack);
    } else {
      this.logger.warn(`[${status}] ${message}`);
    }

    response
      .status(status)
      .json({
        code: status,
        message: message || 'fail',
        data: null,
      })
      .end();
  }
}
