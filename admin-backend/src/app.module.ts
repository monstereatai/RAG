import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoginGuard } from './common/guards/login.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvokeRecordInterceptor } from './common/interceptors/invoke-record.interceptor';
import { CoreModule } from './core/core.module';
import { EnterpriseModule } from './enterprise/enterprise.module';

@Module({
  imports: [
    CoreModule,
    EnterpriseModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: LoginGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: InvokeRecordInterceptor,
    },
  ],
})
export class AppModule {}
