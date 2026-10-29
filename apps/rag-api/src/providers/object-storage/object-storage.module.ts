import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObjectStorageProvider } from './object-storage.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [ObjectStorageProvider],
  exports: [ObjectStorageProvider],
})
export class ObjectStorageModule {}
