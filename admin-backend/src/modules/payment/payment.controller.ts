import { Controller, Get, Post, Body, Put, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get()
  @ApiOperation({ summary: '获取所有支付记录', description: '需要登录' })
  @ApiResponse({ status: 200, description: '成功获取支付列表' })
  @ApiResponse({ status: 401, description: '未认证' })
  findAll() {
    return this.paymentService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个支付记录', description: '需要登录' })
  @ApiParam({ name: 'id', type: String, description: '支付 ID' })
  @ApiResponse({ status: 200, description: '成功获取支付信息' })
  @ApiResponse({ status: 401, description: '未认证' })
  findOne(@Param('id') id: string) {
    return this.paymentService.findOne(id);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: '获取用户支付记录', description: '需要登录' })
  @ApiParam({ name: 'userId', type: String, description: '用户 ID' })
  @ApiResponse({ status: 200, description: '成功获取用户支付信息' })
  @ApiResponse({ status: 401, description: '未认证' })
  findByUserId(@Param('userId') userId: string) {
    return this.paymentService.findByUserId(userId);
  }

  @Post()
  @ApiOperation({ summary: '创建支付', description: '需要登录' })
  @ApiResponse({ status: 201, description: '成功创建支付' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 401, description: '未认证' })
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentService.create(createPaymentDto);
  }

  @Put(':id/status')
  @ApiOperation({ summary: '更新支付状态', description: '需要登录' })
  @ApiParam({ name: 'id', type: String, description: '支付 ID' })
  @ApiResponse({ status: 200, description: '成功更新支付状态' })
  @ApiResponse({ status: 401, description: '未认证' })
  updateStatus(@Param('id') id: string, @Body() updatePaymentStatusDto: UpdatePaymentStatusDto) {
    return this.paymentService.updateStatus(id, updatePaymentStatusDto.status, updatePaymentStatusDto.transactionId);
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: '取消支付', description: '需要登录' })
  @ApiParam({ name: 'id', type: String, description: '支付 ID' })
  @ApiResponse({ status: 200, description: '成功取消支付' })
  @ApiResponse({ status: 401, description: '未认证' })
  cancel(@Param('id') id: string) {
    return this.paymentService.cancelPayment(id);
  }
}