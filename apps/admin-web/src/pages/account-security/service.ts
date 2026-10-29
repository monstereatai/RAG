import { authRequest } from '@/services/rag-admin/api';

export interface SecurityInfo {
  lastPasswordChange: string;
  twoFactorEnabled: boolean;
  loginHistory: {
    ip: string;
    device: string;
    time: string;
    success: boolean;
  }[];
}

export async function getSecurityInfo() {
  return authRequest<{ data: SecurityInfo }>('/api/admin/account/security');
}

export async function changePassword(data: {
  oldPassword: string;
  newPassword: string;
}) {
  return authRequest('/api/admin/account/change-password', {
    method: 'POST',
    data,
  });
}

export async function toggleTwoFactor(enabled: boolean) {
  return authRequest('/api/admin/account/two-factor', {
    method: 'POST',
    data: { enabled },
  });
}
