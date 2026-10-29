import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderService {
  private orders = [
    { id: 1, userId: '1', status: 'completed', amount: 100, createdAt: new Date() },
    { id: 2, userId: '2', status: 'pending', amount: 50, createdAt: new Date() },
  ];

  findAll() {
    return this.orders;
  }

  findOne(id: string) {
    const order = this.orders.find(o => o.id.toString() === id);
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  create(createOrderDto: any) {
    const newOrder = {
      id: this.orders.length + 1,
      ...createOrderDto,
      status: 'pending',
      createdAt: new Date(),
    };
    this.orders.push(newOrder);
    return newOrder;
  }

  updateStatus(id: string, status: string) {
    const order = this.findOne(id);
    order.status = status;
    return order;
  }

  delete(id: string) {
    this.findOne(id);
    this.orders = this.orders.filter(o => o.id.toString() !== id);
    return { message: 'Order deleted successfully' };
  }
}
