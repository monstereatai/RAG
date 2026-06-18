/**
 * RelationalDB Provider 抽象接口
 * 可插拔：postgres | mysql（通过 RELATIONAL_DB_PROVIDER 切换）
 */

export interface IRelationalDbProvider {
  /**
   * 获取底层连接（用于 TypeORM DataSource）
   */
  getDataSourceOptions(): RelationalDbOptions;
}

export interface RelationalDbOptions {
  type: 'postgres' | 'mysql';
  url: string;
  synchronize: boolean;
  logging: boolean;
  entities: string[];
  migrations: string[];
}
