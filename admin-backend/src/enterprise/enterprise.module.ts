import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CacheModule } from '../modules/cache/cache.module';
import { FaultToleranceModule } from '../modules/fault-tolerance/fault-tolerance.module';
import { CircuitBreakerModule } from '../circuit-breaker/circuit-breaker.module';
import { TracingModule } from '../tracing/tracing.module';
import { QueueModule } from '../queue/queue.module';
import { OrderModule } from '../modules/order/order.module';
import { PaymentModule } from '../modules/payment/payment.module';
import { NotifyModule } from '../modules/notify/notify.module';
import { PermissionModule } from '../modules/permission/permission.module';
import { AdminModule } from '../modules/admin/admin.module';
import { SecurityModule } from '../modules/security/security.module';
import { TaskModule } from '../modules/task/task.module';
import { FileModule } from '../modules/file/file.module';
import { MetricsModule } from '../modules/metrics/metrics.module';
import { AdminDocumentsModule } from '../modules/admin-documents/admin-documents.module';
import { AdminNotificationsModule } from '../modules/admin-notifications/admin-notifications.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { RagOpsModule } from '../modules/rag-ops/rag-ops.module';
import { SystemConfigModule } from '../modules/system-config/system-config.module';
import { AccountSecurityModule } from '../modules/account-security/account-security.module';
import { AdminMenusModule } from '../modules/admin-menus/admin-menus.module';
import { MenusModule } from '../modules/menus/menus.module';
import { TeamsModule } from '../modules/teams/teams.module';
import { SearchOpsModule } from '../modules/search-ops/search-ops.module';
import { QaOpsModule } from '../modules/qa-ops/qa-ops.module';
import { GraphOpsModule } from '../modules/graph-ops/graph-ops.module';
import { AgentOpsModule } from '../modules/agent-ops/agent-ops.module';
import { SpeechTicketModule } from '../modules/speech/speech-ticket.module';
// import { GrpcModule } from '../modules/grpc/grpc.module';

@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    QueueModule,
    FaultToleranceModule,
    CircuitBreakerModule,
    TracingModule,
    SecurityModule,
    PermissionModule,
    OrderModule,
    PaymentModule,
    NotifyModule,
    AdminModule,
    TaskModule,
    FileModule,
    MetricsModule,
    AdminDocumentsModule,
    AdminNotificationsModule,
    AuditLogsModule,
    RagOpsModule,
    SystemConfigModule,
    AccountSecurityModule,
    AdminMenusModule,
    MenusModule,
    TeamsModule,
    SearchOpsModule,
    QaOpsModule,
    GraphOpsModule,
    AgentOpsModule,
    SpeechTicketModule,
    // GrpcModule, // disabled: proto file missing, use HTTP rag-client instead
  ],
  exports: [
    DatabaseModule,
    CacheModule,
    QueueModule,
    FaultToleranceModule,
    CircuitBreakerModule,
    TracingModule,
    SecurityModule,
    PermissionModule,
    OrderModule,
    PaymentModule,
    NotifyModule,
    AdminModule,
    TaskModule,
    FileModule,
    MetricsModule,
    AdminDocumentsModule,
    AdminNotificationsModule,
    AuditLogsModule,
    RagOpsModule,
    SystemConfigModule,
    AccountSecurityModule,
    AdminMenusModule,
    MenusModule,
    TeamsModule,
    SearchOpsModule,
    QaOpsModule,
    GraphOpsModule,
    AgentOpsModule,
    SpeechTicketModule,
    // GrpcModule,
  ],
})
export class EnterpriseModule {}
