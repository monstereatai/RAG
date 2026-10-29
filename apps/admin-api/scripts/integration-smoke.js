const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const amqp = require('amqplib');

const config = {
  mysql: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'dev_password123',
    database: process.env.DB_DATABASE || 'nestjs_enterprise_dev',
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672',
  appUrl: process.env.INTEGRATION_APP_URL,
};

async function checkMysql() {
  const connection = await mysql.createConnection(config.mysql);
  const [rows] = await connection.query('SELECT 1 AS ok');
  await connection.end();
  if (rows[0]?.ok !== 1) {
    throw new Error('MySQL SELECT 1 did not return ok=1.');
  }
  console.log('MySQL smoke check passed.');
}

async function checkRedis() {
  const redis = new Redis(config.redis);
  const pong = await redis.ping();
  await redis.quit();
  if (pong !== 'PONG') {
    throw new Error('Redis PING did not return PONG.');
  }
  console.log('Redis smoke check passed.');
}

async function checkRabbitMQ() {
  const connection = await amqp.connect(config.rabbitmqUrl);
  const channel = await connection.createChannel();
  await channel.assertQueue('integration.smoke', { durable: false });
  await channel.deleteQueue('integration.smoke');
  await channel.close();
  await connection.close();
  console.log('RabbitMQ smoke check passed.');
}

async function checkApp() {
  if (!config.appUrl) {
    return;
  }

  const response = await fetch(`${config.appUrl.replace(/\/$/, '')}/health`);
  if (!response.ok) {
    throw new Error(`App health check failed with HTTP ${response.status}.`);
  }
  console.log('App health smoke check passed.');
}

async function main() {
  await checkMysql();
  await checkRedis();
  await checkRabbitMQ();
  await checkApp();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
