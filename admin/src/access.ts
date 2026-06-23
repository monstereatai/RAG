/**
 * RAG 管理后台权限控制
 * 基于 admin-backend RBAC 体系
 */
export default function access(
  initialState: { currentUser?: API.CurrentUser } | undefined,
) {
  const { currentUser } = initialState ?? {};
  const permissions = (currentUser as any)?.permissions ?? [];
  const roles = (currentUser as any)?.roles ?? [];
  const role = (currentUser as any)?.role; // 后端返回 role 字符串

  const hasPermission = (code: string) => permissions.includes(code);
  const hasRole = (name: string) => {
    if (role === name) return true; // 兼容 role 字符串
    if (Array.isArray(roles)) {
      return roles.some((r: any) =>
        typeof r === 'string' ? r === name : r.name === name,
      );
    }
    return false;
  };

  return {
    canAdmin: hasRole('admin') || hasPermission('admin:system:read'),
    canReadDocuments: hasPermission('admin:documents:read'),
    canWriteDocuments: hasPermission('admin:documents:write'),
    canReadAudit: hasPermission('admin:audit:read'),
    canManageRoles: hasPermission('admin:role:*'),
    canManagePermissions: hasPermission('admin:permission:*'),
    canReadSearchOps: hasPermission('admin:search-ops:read'),
    canReadQaOps: hasPermission('admin:qa-ops:read'),
    canReadGraphOps: hasPermission('admin:graph-ops:read'),
    canReadRag: hasPermission('admin:rag:read'),
    canReadNotifications: hasPermission('admin:notifications:read'),
    canWriteNotifications: hasPermission('admin:notifications:write'),
    canReadAccountSecurity: hasPermission('admin:account-security:read'),
  };
}
