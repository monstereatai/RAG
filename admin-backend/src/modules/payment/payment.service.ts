import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentService {
  private payments = [
    { id: 1, orderId: '1', userId: '1', amount: 100, status: 'completed', method: 'credit_card', transactionId: 'tx123', createdAt: new Date() },
    { id: 2, orderId: '2', userId: '2', amount: 50, status: 'pending', method: 'paypal', transactionId: null, createdAt: new Date() },
  ];

  findAll() {
    return this.payments;
  }

  findOne(id: string) {
    const payment = this.payments.find(p => p.id.toString() === id);
    if (!payment) {
      throw new Error('Payment not found');
    }
    return payment;
  }

  findByUserId(userId: string) {
    return this.payments.filter(p => p.userId === userId);
  }

  create(createPaymentDto: any) {
    const newPayment = {
      id: this.payments.length + 1,
      ...createPaymentDto,
      status: 'pending',
      createdAt: new Date(),
    };
    this.payments.push(newPayment);
    return newPayment;
  }

  updateStatus(id: string, status: string, transactionId?: string) {
    const payment = this.findOne(id);
    payment.status = status;
    if (transactionId) {
      payment.transactionId = transactionId;
    }
    return payment;
  }

  cancelPayment(id: string) {
    return this.updateStatus(id, 'cancelled');
  }
}