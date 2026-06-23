import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { QueueService } from '../../queue/queue.service';

@Injectable()
export class NotifyProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotifyProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly mailerService: MailerService,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting NotifyProcessor queue consumer...');
    
    // We register a processor for the 'notification' queue
    await this.queueService.process('notification', async (job) => {
      this.logger.debug(`Processing notification job ${job.id}: ${JSON.stringify(job.data)}`);
      
      const { type, payload } = job.data;
      
      try {
        if (type === 'email_code') {
          await this.mailerService.sendMail({
            to: payload.to,
            subject: 'Your Verification Code',
            html: `<p>Your verification code is: <strong>${payload.code}</strong></p><p>It will expire in 5 minutes.</p>`,
          });
          this.logger.log(`Email sent successfully to ${payload.to}`);
        }
      } catch (error) {
        this.logger.error(`Failed to process notification job ${job.id}`, error);
        throw error; // Let Bull handle retries
      }
    });
  }
}
