import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import Bull, { Queue, Job } from 'bull';
import { Logger } from '@nestjs/common';

export interface JobOptions {
  attempts?: number;
  delay?: number;
  timeout?: number;
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private rabbitmqConnection: amqp.ChannelModel | null = null;
  private rabbitmqChannel: amqp.Channel | null = null;
  private bullQueues: Map<string, Queue> = new Map();
  private readonly defaultQueue = 'default';
  private readonly queueEnabled = process.env.ENABLE_QUEUE === 'true';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (!this.queueEnabled) {
      this.logger.log('Queue integrations are disabled');
      return;
    }

    await this.initializeRabbitMQ();
    await this.initializeBullQueues();
    this.startMonitoring();
  }

  async onModuleDestroy() {
    await this.closeConnections();
  }

  // 初始化RabbitMQ
  private async initializeRabbitMQ() {
    try {
      const rabbitmqUrl = this.configService.get<string>('RABBITMQ_URL', 'amqp://localhost:5672');

      this.rabbitmqConnection = await amqp.connect(rabbitmqUrl);
      this.rabbitmqChannel = await this.rabbitmqConnection.createChannel();

      // 设置QoS
      await this.rabbitmqChannel.prefetch(10);

      // 声明交换机
      await this.rabbitmqChannel.assertExchange('nestjs.exchange', 'direct', { durable: true });

      // 声明队列
      const queues = [
        { name: 'auth.queue', routingKey: 'auth' },
        { name: 'order.queue', routingKey: 'order' },
        { name: 'payment.queue', routingKey: 'payment' },
        { name: 'notification.queue', routingKey: 'notification' },
        { name: 'default.queue', routingKey: 'default' },
      ];

      for (const { name, routingKey } of queues) {
        await this.rabbitmqChannel.assertQueue(name, { durable: true });
        await this.rabbitmqChannel.bindQueue(name, 'nestjs.exchange', routingKey);
      }

      this.logger.log('RabbitMQ initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize RabbitMQ:', error);
    }
  }

  // 初始化Bull队列
  private async initializeBullQueues() {
    const redisConfig = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    };

    const queues = [
      'user',
      'order',
      'payment',
      'notification',
      'default',
    ];

    for (const queueName of queues) {
      const queue = new Bull(queueName, { redis: redisConfig });
      this.bullQueues.set(queueName, queue);

      // 设置事件监听
      queue.on('completed', (job: Job) => {
        this.logger.log(`Job completed: ${job.id} in ${queueName}`);
      });

      queue.on('failed', (job: Job, err: Error) => {
        this.logger.error(`Job failed: ${job.id} in ${queueName}`, err);
      });

      queue.on('stalled', (job: Job) => {
        this.logger.warn(`Job stalled: ${job.id} in ${queueName}`);
      });

      queue.on('error', (err: Error) => {
        this.logger.error(`Queue error in ${queueName}:`, err);
      });
    }

    this.logger.log('Bull queues initialized successfully');
  }

  // Bull队列操作
  async addJob(
    queueName: string,
    data: any,
    options: JobOptions = {}
  ): Promise<Job | null> {
    if (!this.queueEnabled) {
      this.logger.log(`Queue is disabled, simulating job add for ${queueName}`);
      return null;
    }
    const queue = this.bullQueues.get(queueName) || this.bullQueues.get(this.defaultQueue)!;
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return await queue.add(data, {
      attempts: options.attempts || 3,
      delay: options.delay || 0,
      timeout: options.timeout || 30000,
      removeOnComplete: options.removeOnComplete ?? true,
      removeOnFail: options.removeOnFail ?? false,
    });
  }

  async process(queueName: string, processor: (job: Job) => Promise<void>): Promise<void> {
    if (!this.queueEnabled) {
      this.logger.log(`Queue is disabled, skipping process registration for ${queueName}`);
      return;
    }
    const queue = this.bullQueues.get(queueName) || this.bullQueues.get(this.defaultQueue)!;
    if (!queue) {
      this.logger.warn(`Queue ${queueName} not found, skipping process registration`);
      return;
    }
    await queue.process(async (job) => {
      await processor(job);
      return { success: true };
    });
  }

  async getJobStatus(jobId: string, queueName?: string): Promise<any> {
    if (!this.queueEnabled) {
      return null;
    }
    const queue = queueName ? this.bullQueues.get(queueName) : this.bullQueues.get(this.defaultQueue)!;
    if (!queue) return null;

    const job = await queue.getJob(jobId);

    if (!job) return null;

    return {
      id: job.id,
      state: await job.getState(),
      data: job.data,
      attempts: job.attemptsMade,
      failedReason: job.failedReason,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
  }

  // RabbitMQ操作
  async publish(routingKey: string, message: any, options: amqp.Options.Publish = {}) {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const exchange = 'nestjs.exchange';
    const buffer = Buffer.from(JSON.stringify(message));

    this.rabbitmqChannel.publish(exchange, routingKey, buffer, {
      persistent: true,
      ...options,
    });
  }

  async consume(queueName: string, processor: (msg: amqp.ConsumeMessage) => Promise<void>) {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    this.rabbitmqChannel.consume(queueName, async (msg) => {
      if (!msg) return;

      try {
        await processor(msg);
        this.rabbitmqChannel!.ack(msg);
      } catch (error) {
        this.logger.error(`Failed to process message from ${queueName}:`, error);
        this.rabbitmqChannel!.nack(msg, false, true); // requeue
      }
    });
  }

  // 监控队列
  startMonitoring() {
    setInterval(async () => {
      for (const [queueName, queue] of this.bullQueues) {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();

        this.logger.log(`Queue ${queueName}:`, {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
        });
      }
    }, 60000); // 每分钟监控一次
  }

  // 获取队列统计信息
  async getQueueStats(queueName?: string) {
    if (!this.queueEnabled) {
      return {};
    }
    const stats: any = {};

    if (queueName) {
      const queue = this.bullQueues.get(queueName) || this.bullQueues.get(this.defaultQueue)!;
      if (queue) stats[queueName] = await queue.getJobCounts();
    } else {
      for (const [name, queue] of this.bullQueues) {
        stats[name] = await queue.getJobCounts();
      }
    }

    return stats;
  }

  // 关闭连接
  private async closeConnections() {
    // 关闭RabbitMQ连接
    if (this.rabbitmqChannel) {
      await this.rabbitmqChannel.close();
    }
    if (this.rabbitmqConnection) {
      await this.rabbitmqConnection.close();
    }

    // 关闭Bull队列
    for (const queue of this.bullQueues.values()) {
      await queue.close();
    }

    this.logger.log('Queue connections closed');
  }
}
