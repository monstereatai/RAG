import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { Team } from '../../database/entities/team.entity';
import { TeamMember } from '../../database/entities/team-member.entity';
import { User } from '../../database/entities/user.entity';
import { UserModule } from '../user/user.module';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: [
    // UserModule 提供 UserService：内存模式下校验用户是否存在
    UserModule,
    ...(databaseEnabled
      ? [TypeOrmModule.forFeature([Team, TeamMember, User])]
      : []),
  ],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
