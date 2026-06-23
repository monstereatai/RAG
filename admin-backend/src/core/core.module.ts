import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../modules/auth/auth.module';
import { UserModule } from '../modules/user/user.module';
import { getRuntimeEnvFilePaths } from '../config/runtime';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getRuntimeEnvFilePaths(),
    }),
    LoggerModule.forRoot({
      pinoHttp: process.env.NODE_ENV === 'test'
        ? { enabled: false }
        : {
            transport: process.env.NODE_ENV === 'development'
              ? {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                  },
                }
              : undefined,
          },
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
  ],
  exports: [ConfigModule, LoggerModule, ScheduleModule, AuthModule, UserModule],
})
export class CoreModule {}
