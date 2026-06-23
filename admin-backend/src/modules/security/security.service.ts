import { Injectable, OnModuleInit } from '@nestjs/common';
import * as DOMPurify from 'dompurify';
import * as crypto from 'crypto';

@Injectable()
export class SecurityService implements OnModuleInit {
  private readonly encryptionAlgorithm = 'aes-256-cbc';
  private readonly encryptionKey = crypto.randomBytes(32);

  constructor() {}

  onModuleInit() {
    console.log('SecurityService initialized');
  }

  // 1. HTTP头部安全配置（防止XSS、点击劫持、MIME类型混淆等）
  getHelmetConfig() {
    return {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:", "http:"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: [''],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    };
  }

  // 2. 速率限制配置（防止暴力破解、DDoS攻击）
  getRateLimitConfig() {
    return {
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 100, // 每个IP限制100个请求
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    };
  }

  // 3. CORS安全配置
  getCorsConfig() {
    return {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
      maxAge: 86400, // 24小时
    };
  }

  // 4. CSRF防护配置
  getCsrfConfig() {
    return {
      cookie: {
        name: 'XSRF-TOKEN',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
      },
      session: false,
      value: (req) => req.headers['x-xsrf-token'],
    };
  }

  // 5. XSS防护 - 清理用户输入
  sanitizeInput(input: string): string {
    if (typeof input !== 'string') return input;

    // 使用DOMPurify清理HTML
    const sanitized = DOMPurify.sanitize(input, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
    });

    // 额外的字符串清理
    return sanitized.replace(/[<>"']/g, '');
  }

  // 6. SQL注入防护 - 参数化查询
  validateQueryParams(params: any): boolean {
    if (!params || typeof params !== 'object') return false;

    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /onload=/i,
      /onerror=/i,
      /eval\(/i,
      /exec\(/i,
      /union\s+select/i,
      /drop\s+table/i,
      /delete\s+from/i,
      /insert\s+into/i,
      /update\s+set/i,
      /xp_cmdshell/i,
      /;\s*--/i,
      /\/\*/i,
      /\*\//i,
      /@@version/i,
      /sysobjects/i,
      /information_schema/i,
    ];

    for (const key in params) {
      if (typeof params[key] === 'string') {
        for (const pattern of dangerousPatterns) {
          if (pattern.test(params[key])) {
            console.warn(`Potential SQL injection attempt detected in parameter ${key}`);
            return false;
          }
        }
      }
    }

    return true;
  }

  // 7. 数据加密（AES-256）
  encryptData(text: string): { iv: string; encryptedData: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.encryptionAlgorithm, this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted,
    };
  }

  // 8. 数据解密
  decryptData(encryptedData: string, iv: string): string {
    const decipher = crypto.createDecipheriv(
      this.encryptionAlgorithm,
      this.encryptionKey,
      Buffer.from(iv, 'hex'),
    );

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // 9. 密码强度验证
  validatePassword(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!password || password.length < 8) {
      errors.push('密码长度必须至少8位');
    }

    if (!/[a-z]/.test(password)) {
      errors.push('密码必须包含小写字母');
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('密码必须包含大写字母');
    }

    if (!/[0-9]/.test(password)) {
      errors.push('密码必须包含数字');
    }

    if (!/[^a-zA-Z0-9]/.test(password)) {
      errors.push('密码必须包含特殊字符');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // 10. 输入验证
  validateInput(data: any, rules: Record<string, any>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      for (const [field, rule] of Object.entries(rules)) {
        const value = data[field];

        if (rule.required && !value) {
          errors.push(`${field} 是必填项`);
          continue;
        }

        if (value) {
          const typedRule = rule as any;
          if (typedRule.minLength && value.length < typedRule.minLength) {
            errors.push(`${field} 长度至少${typedRule.minLength}位`);
          }

          if (typedRule.maxLength && value.length > typedRule.maxLength) {
            errors.push(`${field} 长度不能超过${typedRule.maxLength}位`);
          }

          if (typedRule.pattern && !typedRule.pattern.test(value)) {
            errors.push(`${field} 格式不正确`);
          }

          if (typedRule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            errors.push(`${field} 必须是有效的邮箱地址`);
          }

          if (typedRule.enum && !typedRule.enum.includes(value)) {
            errors.push(`${field} 必须是以下值之一: ${typedRule.enum.join(', ')}`);
          }
        }
      }
    } catch (error) {
      errors.push('输入验证过程中发生错误');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // 11. 防止主机头注入
  validateHostHeader(host: string): boolean {
    const dangerousPatterns = [
      /\n/i,
      /\r/i,
      /%0A/i,
      /%0D/i,
      /;/i,
      /\\u000d/i,
      /\\u000a/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(host)) {
        console.warn('Potential Host header injection attempt');
        return false;
      }
    }

    return true;
  }

  // 12. 安全日志记录
  logSecurityEvent(event: {
    type: string;
    ip: string;
    userAgent: string;
    action: string;
    details?: any;
  }) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    console.log('Security Event:', JSON.stringify(logEntry, null, 2));

    // 这里可以将日志发送到安全监控系统
    // 例如：ELK Stack、Splunk、安全事件管理系统等
  }

  // 13. 安全配置检查
  performSecurityCheck(): { passed: boolean; issues: string[] } {
    const issues: string[] = [];
    const env = process.env.NODE_ENV;

    // 检查环境变量
    if (!env || env !== 'production') {
      issues.push('警告: 当前不在生产环境');
    }

    // 检查默认密码
    if (process.env.DB_PASSWORD === '123456' || process.env.DB_PASSWORD === 'password') {
      issues.push('警告: 数据库密码过于简单');
    }

    // 检查HTTPS
    if (env === 'production' && !process.env.HTTPS_ENABLED) {
      issues.push('警告: 生产环境未启用HTTPS');
    }

    // 检查JWT密钥
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      issues.push('警告: JWT密钥强度不足');
    }

    return {
      passed: issues.length === 0,
      issues,
    };
  }
}
