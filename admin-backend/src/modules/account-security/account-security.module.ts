import { Module } from '@nestjs/common';
import { AccountSecurityController, AdminSecurityController, AdminAccountController } from './account-security.controller';
import { AccountSecurityService } from './account-security.service';

@Module({
  controllers: [AccountSecurityController, AdminSecurityController, AdminAccountController],
  providers: [AccountSecurityService],
  exports: [AccountSecurityService],
})
export class AccountSecurityModule {}
