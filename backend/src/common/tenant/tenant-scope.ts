import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../interfaces/api-response.interface';

/**
 * 租户隔离的运行时边界。
 *
 * 当前数据库实体尚未完成 tenant_id 迁移，因此 tenantId 保持可选；一旦
 * 请求、任务或资源已经带租户，就不能静默接受另一个租户的值。这个小边界
 * 先统一校验语义，后续迁移实体时不需要在各模块重新发明判断逻辑。
 */
export interface TenantScoped {
  tenantId?: string | null;
}

export function resolveTenantId(
  user: Pick<JwtPayload, 'tenantId'>,
  requestedTenantId?: string | null,
): string | undefined {
  const requested = requestedTenantId?.trim() || undefined;
  const userTenant = user.tenantId?.trim() || undefined;
  if (requested && userTenant && requested !== userTenant) {
    throw new ForbiddenException('tenant scope does not match current user');
  }
  return requested ?? userTenant;
}

export function assertTenantMatch(
  user: Pick<JwtPayload, 'tenantId'>,
  resource: TenantScoped,
): void {
  const userTenant = user.tenantId?.trim();
  const resourceTenant = resource.tenantId?.trim() || undefined;
  if (userTenant && resourceTenant && userTenant !== resourceTenant) {
    throw new ForbiddenException('resource belongs to another tenant');
  }
}
