import { Injectable } from '@nestjs/common';

@Injectable()
export class AdminNotificationsService {
  private readonly notifications = [
    {
      id: 'rag-service-boundary',
      type: 'system',
      title: '管理后台与 RAG 服务已按独立服务边界设计',
      read: false,
      createdAt: new Date().toISOString(),
    },
  ];

  list() {
    return {
      unread: this.notifications.filter((item) => !item.read).length,
      items: this.notifications,
    };
  }
}
