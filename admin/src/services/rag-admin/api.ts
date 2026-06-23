import { request } from '@umijs/max';

const getToken = () => localStorage.getItem('access_token');

export const authRequest = <T = any>(
  url: string,
  options?: { method?: string; data?: any; params?: any },
): Promise<T> => {
  const token = getToken();
  return request<T>(url, {
    ...options,
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
    },
  });
};
