import { request } from '@umijs/max';

const getToken = () => localStorage.getItem('access_token');

export const authRequest = <T = any>(
  url: string,
  options?: {
    method?: string;
    data?: any;
    params?: any;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<T> => {
  const token = getToken();
  const isFormData = typeof FormData !== 'undefined' && options?.data instanceof FormData;
  return request<T>(url, {
    ...options,
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });
};
