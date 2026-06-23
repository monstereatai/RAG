import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';
import { SecurityService } from '../security.service';

@Injectable()
export class SanitizePipe implements PipeTransform {
  constructor(private readonly securityService: SecurityService) {}

  transform(value: any, _metadata: ArgumentMetadata) {
    if (!value) return value;

    // 如果是对象，递归清理所有字符串属性
    if (typeof value === 'object' && value !== null) {
      return this.sanitizeObject(value);
    }

    // 如果是字符串，直接清理
    if (typeof value === 'string') {
      return this.securityService.sanitizeInput(value);
    }

    return value;
  }

  private sanitizeObject(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const result: Record<string, any> = {};
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        result[key] = this.securityService.sanitizeInput(obj[key]);
      } else if (typeof obj[key] === 'object') {
        result[key] = this.sanitizeObject(obj[key]);
      } else {
        result[key] = obj[key];
      }
    }
    return result;
  }
}
