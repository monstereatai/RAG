import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EvidencePolicyService } from './evidence-policy.service';

@Module({
  imports: [ConfigModule],
  providers: [EvidencePolicyService],
  exports: [EvidencePolicyService],
})
export class EvidenceModule {}
