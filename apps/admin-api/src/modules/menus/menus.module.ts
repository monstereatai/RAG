import { Module } from '@nestjs/common';
import { AdminMenusController } from './admin-menus.controller';
import { MenusService } from './menus.service';

@Module({
  controllers: [AdminMenusController],
  providers: [MenusService],
  exports: [MenusService],
})
export class MenusModule {}
