import { request } from '@umijs/max';
import type { CurrentUser } from './data';

export async function queryCurrent(): Promise<{ data: CurrentUser }> {
  return request('/api/accountSettingCurrentUser');
}
