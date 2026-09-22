import { SetMetadata } from '@nestjs/common';

export const API_SCOPES_KEY = 'api_scopes';

/** 为用户侧接口声明 API Token 所需的最小 scope；JWT 用户不受该门禁影响。 */
export const ApiScopes = (...scopes: string[]) =>
  SetMetadata(API_SCOPES_KEY, [
    ...new Set(scopes.map((scope) => scope.trim())),
  ]);
