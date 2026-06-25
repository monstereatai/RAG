import { Injectable } from '@nestjs/common';

/** QA Ops 后台的管理员标识常量 */
export const ADMIN_USER_ID = 'admin-backend';

@Injectable()
export class QaOpsService {
  getAdminUserId(): string {
    return ADMIN_USER_ID;
  }
}
