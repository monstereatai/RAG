import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagClientSearchBase } from './rag-client-search';

export type { RagAguiStreamQuery, RagArtifactCreateInput } from './rag-client.types';

/**
 * 管理后台到 RAG Backend 的唯一 HTTP 边界。
 * 浏览器令牌绝不透传到 RAG 服务；本客户端统一附加内部服务令牌、超时和响应可用性标识，
 * 防止管理端代码绕开权限、审计和降级约定直接访问 RAG 内部实现。
 */
@Injectable()
export class RagClientService extends RagClientSearchBase {
  constructor(private readonly configService: ConfigService) {
    super(configService);
  }
}
