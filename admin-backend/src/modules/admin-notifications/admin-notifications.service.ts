import { Injectable, Optional, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../database/entities/notification.entity';

@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name);

  // 内存回退：数据库未启用时使用
  private readonly memoryFallback: Notification[] = [
    {
      id: 1,
      type: 'system',
      title: '管理后台与 RAG 服务已按独立服务边界设计',
      message: 'admin-backend 通过 HTTP/gRPC 调用 rag-backend，不直接访问向量库。',
      read: false,
      userId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Notification,
  ];
  private memoryIdCounter = 2;

  constructor(
    @Optional()
    @InjectRepository(Notification)
    private readonly notificationRepo?: Repository<Notification>,
  ) {
    if (this.notificationRepo) {
      this.logger.log('Notification persistence enabled (TypeORM)');
    } else {
      this.logger.log('Notification persistence disabled, using in-memory fallback');
    }
  }

  async list() {
    if (this.notificationRepo) {
      const items = await this.notificationRepo.find({
        order: { createdAt: 'DESC' },
        take: 100,
      });
      const unread = await this.notificationRepo.count({
        where: { read: false },
      });
      return { unread, items };
    }

    return {
      unread: this.memoryFallback.filter((item) => !item.read).length,
      items: this.memoryFallback,
    };
  }

  async unreadCount() {
    if (this.notificationRepo) {
      const unread = await this.notificationRepo.count({
        where: { read: false },
      });
      return { unread };
    }

    return {
      unread: this.memoryFallback.filter((item) => !item.read).length,
    };
  }

  async markRead(id: string) {
    if (this.notificationRepo) {
      const numericId = Number(id);
      if (Number.isNaN(numericId)) {
        return { found: false, unread: 0 };
      }
      await this.notificationRepo.update({ id: numericId }, { read: true });
      const unread = await this.notificationRepo.count({
        where: { read: false },
      });
      return { found: true, unread };
    }

    const notification = this.memoryFallback.find(
      (item) => String(item.id) === id,
    );
    if (notification) {
      notification.read = true;
    }
    return {
      found: Boolean(notification),
      unread: this.memoryFallback.filter((item) => !item.read).length,
    };
  }

  async markAllRead() {
    if (this.notificationRepo) {
      await this.notificationRepo.update({ read: false }, { read: true });
      return { unread: 0 };
    }

    for (const notification of this.memoryFallback) {
      notification.read = true;
    }
    return { unread: 0 };
  }

  /** 创建通知（供内部模块调用） */
  async create(params: {
    type?: 'system' | 'info' | 'warning' | 'error';
    title: string;
    message?: string;
    userId?: string;
  }): Promise<void> {
    if (this.notificationRepo) {
      const entity = this.notificationRepo.create({
        type: params.type ?? 'info',
        title: params.title,
        message: params.message ?? null,
        userId: params.userId ?? null,
        read: false,
      });
      await this.notificationRepo.save(entity);
      return;
    }

    this.memoryFallback.unshift({
      id: this.memoryIdCounter++,
      type: params.type ?? 'info',
      title: params.title,
      message: params.message ?? null,
      read: false,
      userId: params.userId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Notification);
  }
}
