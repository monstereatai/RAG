import { authRequest } from '@/services/rag-admin/api';
import type { CurrentUser, ListItemDataType } from './data.d';

export interface ProfileData {
  department: string;
  position: string;
  phone: string;
  createdAt: string;
  updatedAt?: string;
  name: string;
  email: string;
  username: string;
  avatar?: string;
}

export const getProfile = (): Promise<ProfileData> => {
  return authRequest<ProfileData>('/api/admin/profile');
};
