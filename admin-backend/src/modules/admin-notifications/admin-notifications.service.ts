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

  async list(query?: any) {
    let items: Notification[];
    if (this.notificationRepo) {
      items = await this.notificationRepo.find({
        order: { createdAt: 'DESC' },
        take: 100,
      });
    } else {
      items = [...this.memoryFallback];
    }

    // 筛选
    if (query?.type) {
      items = items.filter((item) => item.type === query.type);
    }
    if (query?.read !== undefined) {
      items = items.filter((item) => item.read === (query.read === 'true' || query.read === true));
    }

    // 分页
    const page = Number(query?.current) || 1;
    const pageSize = Number(query?.pageSize) || 10;
    const start = (page - 1) * pageSize;

    const unread = items.filter((item) => !item.read).length;
    return {
      data: items.slice(start, start + pageSize).map((item) => ({
        id: String(item.id),
        title: item.title,
        content: item.message,
        type: item.type,
        read: item.read,
        createdAt: item.createdAt?.toISOString?.() ?? item.createdAt,
      })),
      total: items.length,
      unread,
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

  /** 删除通知 */
  async delete(id: string) {
    if (this.notificationRepo) {
      const numericId = Number(id);
      if (!Number.isNaN(numericId)) {
        await this.notificationRepo.delete(numericId);
      }
      return { success: true };
    }

    const index = this.memoryFallback.findIndex((item) => String(item.id) === id);
    if (index !== -1) {
      this.memoryFallback.splice(index, 1);
    }
    return { success: true };
  }
}
