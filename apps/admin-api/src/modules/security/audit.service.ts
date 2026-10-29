import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Optional()
    @InjectRepository(AuditLog)
    private readonly auditRepository?: Repository<AuditLog>,
  ) {}

  async logAction(data: Partial<AuditLog>): Promise<void> {
    try {
      if (!this.auditRepository) {
        this.logger.debug('AuditLog: Database disabled, simulating log: ' + JSON.stringify(data));
        return;
      }
      
      const log = this.auditRepository.create(data);
      // Fire and forget, don't await to avoid blocking the main thread
      this.auditRepository.save(log).catch(err => {
        this.logger.error('Failed to save audit log', err);
      });
    } catch (error) {
      this.logger.error('Failed to process audit log', error);
    }
  }
}
