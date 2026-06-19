import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session } from 'neo4j-driver';

@Injectable()
export class Neo4jProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jProvider.name);
  private driver: Driver;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const uri = this.config.get<string>('NEO4J_URI') ?? 'bolt://localhost:7687';
    const user = this.config.get<string>('NEO4J_USER') ?? 'neo4j';
    const password = this.config.get<string>('NEO4J_PASSWORD') ?? 'neo4jpassword';

    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    
    try {
      await this.driver.verifyConnectivity();
      this.logger.log('Connected to Neo4j successfully.');
    } catch (error) {
      this.logger.warn(`Failed to connect to Neo4j: ${(error as Error).message}. Graph features will be disabled.`);
    }
  }

  async onModuleDestroy() {
    if (this.driver) {
      await this.driver.close();
      this.logger.log('Neo4j driver closed.');
    }
  }

  getReadSession(): Session {
    return this.driver.session({ defaultAccessMode: neo4j.session.READ });
  }

  getWriteSession(): Session {
    return this.driver.session({ defaultAccessMode: neo4j.session.WRITE });
  }

  async executeRead<T>(query: string, params: any = {}): Promise<T[]> {
    const session = this.getReadSession();
    try {
      const result = await session.run(query, params);
      return result.records.map((r) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }

  async executeWrite<T>(query: string, params: any = {}): Promise<T[]> {
    const session = this.getWriteSession();
    try {
      const result = await session.run(query, params);
      return result.records.map((r) => r.toObject() as T);
    } finally {
      await session.close();
    }
  }
}
