import { authRequest } from '@/services/rag-admin/api';

export interface TeamItem {
  id: string;
  name: string;
  description?: string | null;
  memberCount: number;
  createdAt: string;
}

export interface TeamMemberItem {
  id: string;
  teamId: string;
  userId: string;
  username: string;
  email: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface UserOption {
  id: string;
  username: string;
  email: string;
}

export async function getTeams(params?: {
  current?: number;
  pageSize?: number;
  name?: string;
}) {
  return authRequest<{ data: TeamItem[]; total: number }>('/api/admin/teams', {
    params,
  });
}

export async function createTeam(data: { name: string; description?: string }) {
  return authRequest('/api/admin/teams', { method: 'POST', data });
}

export async function updateTeam(
  id: string,
  data: { name?: string; description?: string },
) {
  return authRequest(`/api/admin/teams/${id}`, { method: 'PATCH', data });
}

export async function deleteTeam(id: string) {
  return authRequest(`/api/admin/teams/${id}`, { method: 'DELETE' });
}

export async function getTeamMembers(teamId: string) {
  return authRequest<{ data: TeamMemberItem[] }>(
    `/api/admin/teams/${teamId}/members`,
  );
}

export async function addTeamMember(
  teamId: string,
  data: { userId: number; role?: 'owner' | 'member' },
) {
  return authRequest(`/api/admin/teams/${teamId}/members`, {
    method: 'POST',
    data,
  });
}

export async function removeTeamMember(teamId: string, userId: string) {
  return authRequest(`/api/admin/teams/${teamId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export async function getUserOptions() {
  return authRequest<{ data: UserOption[] }>('/api/admin/users', {
    params: { current: 1, pageSize: 100 },
  });
}
