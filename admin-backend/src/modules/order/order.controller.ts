import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @ApiOperation({ summary: '获取所有订单', description: '需要登录' })
  @ApiResponse({ status: 200, description: '成功获取订单列表' })
  @ApiResponse({ status: 401, description: '未认证' })
  findAll() {
    return this.orderService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个订单', description: '需要登录' })
  @ApiParam({ name: 'id', type: String, description: '订单 ID' })
  @ApiResponse({ status: 200, description: '成功获取订单信息' })
  @ApiResponse({ status: 401, description: '未认证' })
  findOne(@Param('id') id: string) {
    return this.orderService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建订单', description: '需要登录' })
  @ApiResponse({ status: 201, description: '成功创建订单' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 401, description: '未认证' })
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.orderService.create(createOrderDto);
  }

  @Put(':id/status')
  @ApiOperation({ summary: '更新订单状态', description: '需要登录' })
  @ApiParam({ name: 'id', type: String, description: '订单 ID' })
  @ApiResponse({ status: 200, description: '成功更新订单状态' })
  @ApiResponse({ status: 401, description: '未认证' })
  updateStatus(@Param('id') id: string, @Body() updateOrderStatusDto: UpdateOrderStatusDto) {
    return this.orderService.updateStatus(id, updateOrderStatusDto.status);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除订单', description: '需要登录' })
  @ApiParam({ name: 'id', type: String, description: '订单 ID' })
  @ApiResponse({ status: 200, description: '成功删除订单' })
  @ApiResponse({ status: 401, description: '未认证' })
  delete(@Param('id') id: string) {
    return this.orderService.delete(id);
  }
}