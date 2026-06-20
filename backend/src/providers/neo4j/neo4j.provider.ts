import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session } from 'neo4j-driver';

@Injectable()
export class Neo4jProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jProvider.name);
  private driver: Driver | null = null;
  private enabled = false;
  private connected = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.enabled = this.config.get<boolean>('neo4j.enabled') ?? false;
    if (!this.enabled) {
      this.logger.log(
        'GraphRAG is disabled. Set GRAPH_RAG_ENABLED=true to enable Neo4j.',
      );
      return;
    }

    const uri = this.config.get<string>('neo4j.url') ?? 'bolt://localhost:7687';
    const user = this.config.get<string>('neo4j.username') ?? 'neo4j';
    const password = this.config.get<string>('neo4j.password') ?? '';

    if (!password) {
      this.logger.warn(
        'Neo4j password is empty. Graph features will be disabled.',
      );
      this.enabled = false;
      return;
    }

    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

    try {
      await this.driver.verifyConnectivity();
      this.connected = true;
      this.logger.log('Connected to Neo4j successfully.');
    } catch (error) {
      this.connected = false;
      this.logger.warn(
        `Failed to connect to Neo4j: ${(error as Error).message}. Graph features will be disabled.`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.driver) {
      await this.driver.close();
      this.logger.log('Neo4j driver closed.');
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.connected && !!this.driver;
  }

  getReadSession(): Session {
    if (!this.isEnabled() || !this.driver) {
      throw new ServiceUnavailableException(
        'GraphRAG is disabled or Neo4j is unavailable',
      );
    }
    return this.driver.session({ defaultAccessMode: neo4j.session.READ });
  }

  getWriteSession(): Session {
    if (!this.isEnabled() || !this.driver) {
      throw new ServiceUnavailableException(
        'GraphRAG is disabled or Neo4j is unavailable',
      );
    }
    return this.driver.session({ defaultAccessMode: neo4j.session.WRITE });
  }

  async executeRead<T>(
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const session = this.getReadSession();
    try {
      const result = await session.run(query, params);
      return result.records.map((r) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }

  async executeWrite<T>(
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const session = this.getWriteSession();
    try {
      const result = await session.run(query, params);
      return result.records.map((r) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }
}
