import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEventOutboxEntity } from '../../providers/db/entities/domain-event-outbox.entity';
import { DomainEventSubscriptionEntity } from '../../providers/db/entities/domain-event-subscription.entity';
import { DomainEventDeliveryEntity } from '../../providers/db/entities/domain-event-delivery.entity';
import { DomainEventsService } from './domain-events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DomainEventOutboxEntity,
      DomainEventSubscriptionEntity,
      DomainEventDeliveryEntity,
    ]),
  ],
  providers: [DomainEventsService],
  exports: [DomainEventsService],
})
export class DomainEventsModule {}
