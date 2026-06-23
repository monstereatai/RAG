import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ReadWriteSplittingService implements OnModuleInit {
  private masterDataSource: DataSource;
  private slaveDataSource: DataSource;
  private masterLoad: number = 0;
  private slaveLoad: number = 0;
  private lastHealthCheck: number = Date.now();

  constructor(
    @InjectDataSource('master') masterDataSource: DataSource,
    @InjectDataSource('slave') slaveDataSource: DataSource,
    private readonly configService: ConfigService
  ) {
    this.masterDataSource = masterDataSource;
    this.slaveDataSource = slaveDataSource;
  }

  async onModuleInit() {
    // 初始化健康检查
    setInterval(() => {
      this.healthCheck();
    }, 30000); // 每30秒检查一次

    console.log('Read-Write Splitting Service initialized');
  }

  // 获取数据源（根据操作类型）
  async getDataSource(operation: 'read' | 'write'): Promise<DataSource> {
    if (operation === 'write') {
      return this.masterDataSource;
    }

    // 读操作优先从库
    if (this.slaveDataSource.isInitialized) {
      // 检查从库延迟
      if (this.checkSlaveLag()) {
        console.warn('Slave database lag detected, switching to master for read');
        return this.masterDataSource;
      }
      return this.slaveDataSource;
    }

    // 从库未初始化，使用主库
    console.warn('Slave database not initialized, using master for read');
    return this.masterDataSource;
  }

  // 执行查询
  async query<T>(sql: string, parameters?: any[], operation: 'read' | 'write' = 'read'): Promise<T[]> {
    const dataSource = await this.getDataSource(operation);
    return dataSource.query(sql, parameters);
  }

  // 执行原生查询
  async queryRaw<T>(sql: string, parameters?: any[]): Promise<T> {
    // 原生查询必须使用主库
    return this.masterDataSource.query(sql, parameters);
  }

  // 开始事务
  async startTransaction() {
    const connection = await this.getDataSource('write');
    const queryRunner = connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    return queryRunner;
  }

  // 执行查询带事务
  async transaction<T>(callback: (queryRunner: any) => Promise<T>): Promise<T> {
    const queryRunner = await this.startTransaction();
    try {
      const result = await callback(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // 检查从库延迟
  private async checkSlaveLag(): Promise<boolean> {
    if (!this.slaveDataSource.isInitialized) {
      return true;
    }

    try {
      // 执行SQL获取主从延迟（MySQL）
      const masterTime = await this.masterDataSource.query('SELECT NOW() as time');
      const slaveTime = await this.slaveDataSource.query('SELECT NOW() as time');

      const masterTimestamp = new Date(masterTime[0].time).getTime();
      const slaveTimestamp = new Date(slaveTime[0].time).getTime();
      const lag = masterTimestamp - slaveTimestamp;

      const maxLag = this.configService.get<number>('MAX_SLAVE_LAG', 3000); // 3秒延迟阈值

      if (lag > maxLag) {
        console.warn(`Slave lag detected: ${lag}ms (threshold: ${maxLag}ms)`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to check slave lag:', error);
      return true; // 出错时切换到主库
    }
  }

  // 更新负载信息
  updateLoad(operation: 'read' | 'write') {
    if (operation === 'read') {
      this.slaveLoad++;
    } else {
      this.masterLoad++;
    }

    // 每100次操作记录一次负载
    if (this.masterLoad % 100 === 0 || this.slaveLoad % 100 === 0) {
      console.log(`Load: Master R:${this.masterLoad} | Slave R:${this.slaveLoad}`);
    }
  }

  // 获取健康状态
  getHealthStatus() {
    return {
      master: {
        connected: this.masterDataSource.isInitialized,
        load: this.masterLoad,
      },
      slave: {
        connected: this.slaveDataSource.isInitialized,
        load: this.slaveLoad,
        lag: this.lastHealthCheck ? Date.now() - this.lastHealthCheck : 0,
      },
      status: this.slaveDataSource.isInitialized ? 'HEALTHY' : 'DEGRADED',
    };
  }

  // 健康检查
  private async healthCheck() {
    const now = Date.now();
    this.lastHealthCheck = now;

    const masterHealthy = await this.checkConnection(this.masterDataSource);
    const slaveHealthy = await this.checkConnection(this.slaveDataSource);

    if (!masterHealthy) {
      console.error('Master database is not responding!');
    }

    if (!slaveHealthy) {
      console.warn('Slave database is not responding!');
    }

    // 重置负载计数
    if (now - this.lastHealthCheck > 600000) { // 10分钟
      this.masterLoad = 0;
      this.slaveLoad = 0;
    }
  }

  // 检查数据库连接
  private async checkConnection(dataSource: DataSource): Promise<boolean> {
    try {
      if (!dataSource.isInitialized) {
        return false;
      }

      // 执行简单查询测试连接
      await dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      console.error(`Database connection check failed:`, error);
      return false;
    }
  }

  // 获取数据源统计信息
  async getStats() {
    const masterStats = await this.getDataSourceStats(this.masterDataSource);
    const slaveStats = this.slaveDataSource.isInitialized ? await this.getDataSourceStats(this.slaveDataSource) : null;

    return {
      master: masterStats,
      slave: slaveStats,
      overall: {
        readRatio: this.calculateReadRatio(),
        replicationStatus: this.getReplicationStatus(),
      },
    };
  }

  // 获取数据源统计信息
  private async getDataSourceStats(dataSource: DataSource) {
    try {
      const [connections] = await dataSource.query('SHOW STATUS LIKE "Threads_connected"');
      const [maxConnections] = await dataSource.query('SHOW VARIABLES LIKE "max_connections"');

      return {
        connections: connections.Value || 0,
        maxConnections: maxConnections.Value || 0,
        connectionRatio: connections.Value ? (parseInt(connections.Value) / parseInt(maxConnections.Value)) * 100 : 0,
      };
    } catch (error) {
      console.error('Failed to get database stats:', error);
      return null;
    }
  }

  // 计算读操作比率
  private calculateReadRatio(): number {
    const total = this.masterLoad + this.slaveLoad;
    if (total === 0) return 0;
    return (this.slaveLoad / total) * 100;
  }

  // 获取复制状态
  private getReplicationStatus(): string {
    if (!this.slaveDataSource.isInitialized) {
      return 'NOT_CONFIGURED';
    }

    if (this.masterLoad > 0 && this.slaveLoad > 0) {
      return 'ACTIVE';
    }

    if (this.masterLoad > 0) {
      return 'READ_ONLY';
    }

    return 'SYNCING';
  }
}