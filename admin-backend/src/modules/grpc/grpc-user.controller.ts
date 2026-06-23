/**
 * gRPC UserController 示例
 * 
 * 使用前请先安装依赖：
 *   npm install @nestjs/microservices @grpc/grpc-js @grpc/proto-loader
 * 安装后，将此文件整体解除注释即可使用。
 */

/*
import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { UserService } from '../user/user.service';

@Controller()
export class GrpcUserController {
  constructor(private readonly userService: UserService) {}

  // 对应 user.proto 中的 rpc GetUser
  @GrpcMethod('UserService', 'GetUser')
  async getUser(data: { id: number }) {
    const user = await this.userService.findOne(data.id);
    if (!user) {
      throw new Error('User not found');
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }

  // 对应 user.proto 中的 rpc CreateUser
  @GrpcMethod('UserService', 'CreateUser')
  async createUser(data: any) {
    const user = await this.userService.create(data);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }
}
*/
