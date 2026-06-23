/**
 * GrpcModule 示例
 * 
 * 使用前请先安装依赖：
 *   npm install @nestjs/microservices @grpc/grpc-js @grpc/proto-loader
 * 安装后，将此文件整体解除注释并在 AppModule 中导入即可。
 */

/*
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { GrpcUserController } from './grpc-user.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    UserModule,
    // 注册 gRPC 客户端，用于调用其他微服务（可选）
    ClientsModule.register([
      {
        name: 'USER_PACKAGE',
        transport: Transport.GRPC,
        options: {
          package: 'grpc.user',
          protoPath: join(__dirname, 'proto/user.proto'),
          url: 'localhost:50051',
        },
      },
    ]),
  ],
  controllers: [GrpcUserController],
})
export class GrpcModule {}
*/
