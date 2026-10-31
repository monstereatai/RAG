import { authRequest } from '@/services/rag-admin/api';

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
