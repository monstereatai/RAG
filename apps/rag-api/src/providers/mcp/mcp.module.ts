import { Module, Global } from '@nestjs/common';
import { McpProvider } from './mcp.provider';

@Global()
@Module({
  providers: [McpProvider],
  exports: [McpProvider],
})
export class McpModule {}
