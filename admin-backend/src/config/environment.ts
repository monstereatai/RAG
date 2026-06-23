export interface EnvironmentConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  HTTPS_ENABLED: boolean;
  DB_CONFIG: {
    HOST: string;
    PORT: number;
    USERNAME: string;
    PASSWORD: string;
    DATABASE: string;
    SYNCHRONIZE: boolean;
    LOGGING: boolean;
    MASTER_HOST?: string;
    SLAVE_HOST?: string;
  };
  REDIS_CONFIG: {
    HOST: string;
    PORT: number;
    PASSWORD?: string;
    DB: number;
  };
  JWT_CONFIG: {
    SECRET: string;
    EXPIRES_IN: string;
    REFRESH_SECRET: string;
    REFRESH_EXPIRES_IN: string;
  };
  RABBITMQ_CONFIG: {
    URL: string;
    HOST: string;
    PORT: number;
    USERNAME: string;
    PASSWORD: string;
  };
  CORS_CONFIG: {
    ORIGIN: string[];
    METHODS: string[];
    CREDENTIALS: boolean;
  };
  SECURITY_CONFIG: {
    RATE_LIMIT_MAX: number;
    RATE_LIMIT_WINDOW_MS: number;
    MAX_SLAVE_LAG: number;
    ENCRYPTION_ALGORITHM: string;
    SESSION_SECRET: string;
  };
  LOGGING_CONFIG: {
    LEVEL: 'debug' | 'info' | 'warn' | 'error';
    FILE_PATH?: string;
  };
}

function createConfig(): EnvironmentConfig {
  return {
    NODE_ENV: process.env.NODE_ENV as any || 'development',
    PORT: parseInt(process.env.PORT, 10) || 3001,
    HTTPS_ENABLED: process.env.HTTPS_ENABLED === 'true',
    DB_CONFIG: {
      HOST: process.env.DB_HOST || 'localhost',
      PORT: parseInt(process.env.DB_PORT, 10) || 3306,
      USERNAME: process.env.DB_USERNAME || 'root',
      PASSWORD: process.env.DB_PASSWORD || '123456',
      DATABASE: process.env.DB_DATABASE || 'nestjs_enterprise',
      SYNCHRONIZE: process.env.DB_SYNCHRONIZE === 'true',
      LOGGING: process.env.DB_LOGGING === 'true',
      MASTER_HOST: process.env.MASTER_DB_HOST,
      SLAVE_HOST: process.env.SLAVE_DB_HOST,
    },
    REDIS_CONFIG: {
      HOST: process.env.REDIS_HOST || 'localhost',
      PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
      PASSWORD: process.env.REDIS_PASSWORD,
      DB: parseInt(process.env.REDIS_DB, 10) || 0,
    },
    JWT_CONFIG: {
      SECRET: process.env.JWT_SECRET || 'your-secret-key',
      EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
      REFRESH_SECRET: process.env.REFRESH_SECRET || 'your-refresh-secret',
      REFRESH_EXPIRES_IN: process.env.REFRESH_EXPIRES_IN || '7d',
    },
    RABBITMQ_CONFIG: {
      URL: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
      HOST: process.env.RABBITMQ_HOST || 'localhost',
      PORT: parseInt(process.env.RABBITMQ_PORT, 10) || 5672,
      USERNAME: process.env.RABBITMQ_USERNAME || 'guest',
      PASSWORD: process.env.RABBITMQ_PASSWORD || 'guest',
    },
    CORS_CONFIG: {
      ORIGIN: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
      METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      CREDENTIALS: process.env.CORS_CREDENTIALS === 'true',
    },
    SECURITY_CONFIG: {
      RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
      RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
      MAX_SLAVE_LAG: parseInt(process.env.MAX_SLAVE_LAG, 10) || 3000,
      ENCRYPTION_ALGORITHM: process.env.ENCRYPTION_ALGORITHM || 'aes-256-cbc',
      SESSION_SECRET: process.env.SESSION_SECRET || 'your-session-secret',
    },
    LOGGING_CONFIG: {
      LEVEL: process.env.LOG_LEVEL as any || 'info',
      FILE_PATH: process.env.LOG_FILE_PATH,
    },
  };
}

export const config = createConfig();

// 兼容旧版本
export const ENV = config;