import { Injectable } from '@nestjs/common';
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';

@Injectable()
@Catch(HttpException)
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception.getStatus();

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: exception.message,
      error: exception.name,
    };

    response.status(status).json(errorResponse);
  }
}
