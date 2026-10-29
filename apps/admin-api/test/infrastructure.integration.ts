import * as mysql from 'mysql2/promise';
import Redis from 'ioredis';
import * as amqp from 'amqplib';

const integrationEnabled = process.env.INTEGRATION_TESTS === 'true';
const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('Docker integration infrastructure', () => {
  it('connects to MySQL', async () => {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || 'dev_password123',
      database: process.env.DB_DATABASE || 'nestjs_enterprise_dev',
    });

    const [rows] = await connection.query('SELECT 1 AS ok');
    await connection.end();
    expect((rows as Array<{ ok: number }>)[0].ok).toBe(1);
  });

  it('connects to Redis', async () => {
    const redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    });

    await expect(redis.ping()).resolves.toBe('PONG');
    await redis.quit();
  });

  it('connects to RabbitMQ', async () => {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672');
    const channel = await connection.createChannel();

    await channel.assertQueue('integration.smoke', { durable: false });
    await channel.deleteQueue('integration.smoke');
    await channel.close();
    await connection.close();
  });
});
