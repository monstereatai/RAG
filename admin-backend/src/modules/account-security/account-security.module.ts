import { Module } from '@nestjs/common';
import { AccountSecurityController } from './account-security.controller';
import { AccountSecurityService } from './account-security.service';

@Module({
  controllers: [AccountSecurityController],
  providers: [AccountSecurityService],
  exports: [AccountSecurityService],
})
export class AccountSecurityModule {}
