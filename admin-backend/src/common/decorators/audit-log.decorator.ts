import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'audit_log_metadata';

export interface AuditLogMetadata {
  module: string;
  action: string;
}

export const AuditLog = (module: string, action: string) => SetMetadata(AUDIT_LOG_KEY, { module, action });
