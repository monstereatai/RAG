import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression, Interval, SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class TaskService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskService.name);

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'test') {
      return;
    }

    if (this.schedulerRegistry.getIntervals().includes('health_check_ping')) {
      this.schedulerRegistry.deleteInterval('health_check_ping');
    }

    if (this.schedulerRegistry.getCronJobs().has('cleanup_expired_tokens')) {
      this.schedulerRegistry.deleteCronJob('cleanup_expired_tokens');
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'cleanup_expired_tokens',
    timeZone: 'Asia/Shanghai',
  })
  handleCron() {
    this.logger.debug('Running nightly cleanup task...');
    // Add logic to clean up expired refresh tokens, temp files, etc.
  }

  @Interval('health_check_ping', 300000) // 5 minutes
  handleInterval() {
    this.logger.verbose('Background health check ping executed');
  }
}
