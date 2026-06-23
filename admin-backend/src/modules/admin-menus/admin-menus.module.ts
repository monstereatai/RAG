import { Module } from '@nestjs/common';
import { AdminMenusController } from './admin-menus.controller';
import { AdminMenusService } from './admin-menus.service';

@Module({
  controllers: [AdminMenusController],
  providers: [AdminMenusService],
})
export class AdminMenusModule {}
