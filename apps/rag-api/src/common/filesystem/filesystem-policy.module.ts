import { Module } from '@nestjs/common';
import { FileAccessPolicyService } from './file-access-policy.service';

@Module({
  providers: [FileAccessPolicyService],
  exports: [FileAccessPolicyService],
})
export class FilesystemPolicyModule {}
