import { Module } from '@nestjs/common';
import { DatabaseReplicationModule } from './database-replication.module';
import { ReadWriteSplittingService } from './read-write-splitting.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseReplicationModule,
  ],
  providers: [ReadWriteSplittingService],
  exports: [ReadWriteSplittingService],
})
export class ReadWriteSplittingModule {}