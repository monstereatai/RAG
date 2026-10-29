import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_DATABASE || 'nestjs_enterprise',
  entities: [User, Order, Payment],
  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  logging: process.env.DB_LOGGING === 'true',
});

export async function initializeDatabase() {
  try {
    await AppDataSource.initialize();
    console.log('数据库连接成功');

    // 创建默认管理员用户
    const userRepository = AppDataSource.getRepository(User);
    const adminExists = await userRepository.findOne({ where: { username: 'admin' } });

    if (!adminExists) {
      const admin = userRepository.create({
        username: 'admin',
        email: 'admin@example.com',
        password: '$2a$10$r2zR3tK6N3J8vN4xY6v5uO7I8H9K0L1M2N3O4P5Q6R7S8T9U0V1', // 密码: admin123
        role: 'admin',
        isActive: true,
      });
      await userRepository.save(admin);
      console.log('默认管理员用户已创建');
    }

    return AppDataSource;
  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw error;
  }
}