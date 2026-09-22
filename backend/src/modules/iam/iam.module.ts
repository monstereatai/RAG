import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IamTenantEntity } from '../../providers/db/entities/iam-tenant.entity';
import { IamMembershipEntity } from '../../providers/db/entities/iam-membership.entity';
import { IamRoleEntity } from '../../providers/db/entities/iam-role.entity';
import { IamPermissionEntity } from '../../providers/db/entities/iam-permission.entity';
import { IamRolePermissionEntity } from '../../providers/db/entities/iam-role-permission.entity';
import { IamMembershipRoleEntity } from '../../providers/db/entities/iam-membership-role.entity';
import { IamService } from './iam.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      IamTenantEntity,
      IamMembershipEntity,
      IamRoleEntity,
      IamPermissionEntity,
      IamRolePermissionEntity,
      IamMembershipRoleEntity,
    ]),
  ],
  providers: [IamService],
  exports: [IamService],
})
export class IamModule {}
