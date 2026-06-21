import { SetMetadata } from '@nestjs/common';
import type { JwtPayload } from '../interfaces/api-response.interface';

export const ROLES_KEY = 'roles';
export type UserRole = JwtPayload['role'];

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
