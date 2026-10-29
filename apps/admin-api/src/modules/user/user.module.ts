import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isDatabaseEnabled } from '../../config/runtime';
import { User } from '../../database/entities/user.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';

const databaseEnabled = isDatabaseEnabled();

@Module({
  imports: databaseEnabled ? [TypeOrmModule.forFeature([User])] : [],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
