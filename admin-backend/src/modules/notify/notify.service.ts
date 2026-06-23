import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../../queue/queue.service';
import { CacheService } from '../cache/cache.service';
import { NotifyGateway } from './notify.gateway';

export interface NotificationData {
  to: string;
  subject?: string;
  message: string;
  template?: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    private readonly cacheService: CacheService,
    private readonly notifyGateway: NotifyGateway,
  ) {}

  async sendVerificationCode(email: string): Promise<{ message: string }> {
    // 1. Generate 6 digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 2. Save to cache (valid for 5 minutes)
    await this.cacheService.set(`verify_code_${email}`, code, 300);

    // 3. Dispatch to Queue
    this.logger.log(`Dispatching email code task to queue for ${email}`);
    await this.queueService.addJob('notification', {
      type: 'email_code',
      payload: { to: email, code },
    });

    return { message: 'Verification code dispatched successfully' };
  }

  async sendEmail(notification: NotificationData): Promise<void> {
    this.logger.log('Dispatching generic email to queue:', notification);
    await this.queueService.addJob('notification', {
      type: 'generic_email',
      payload: notification,
    });
  }

  async sendSMS(phoneNumber: string, message: string): Promise<void> {
    this.logger.log('Sending SMS to', phoneNumber, ':', message);
    // TODO: Implement SMS service integration
  }

  async sendPushNotification(userId: number, title: string, body: string): Promise<void> {
    this.logger.log('Sending push notification to user', userId, ':', title, '-', body);
    this.notifyGateway.sendToUser(userId.toString(), 'push_notification', { title, body });
  }

  async sendOrderNotification(orderId: number, type: 'created' | 'updated' | 'cancelled'): Promise<void> {
    const message = `Order ${type}: Order #${orderId}`;
    this.logger.log('Sending order notification:', message);
    this.notifyGateway.sendToAll('order_update', { orderId, type, message });
  }

  async sendPaymentNotification(paymentId: number, status: string): Promise<void> {
    const message = `Payment status updated: Payment #${paymentId} - ${status}`;
    this.logger.log('Sending payment notification:', message);
    this.notifyGateway.sendToAll('payment_update', { paymentId, status, message });
  }
}