import { Global, Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ApiTokenService } from './api-token.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ({
          secret: config.get<string>('auth.jwtSecret'),
          signOptions: {
            expiresIn: config.get<string>('auth.jwtExpiresIn') ?? '7d',
          },
        }) as unknown as JwtModuleOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, ApiTokenService],
  exports: [AuthService, ApiTokenService, JwtModule],
})
export class AuthModule {}
