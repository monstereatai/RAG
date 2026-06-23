import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import * as fs from 'fs';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uploadDir = configService.get<string>('UPLOAD_DIR') || join(process.cwd(), 'uploads');
        
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        return {
          storage: diskStorage({
            destination: uploadDir,
            filename: (req, file, cb) => {
              const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
              const ext = extname(file.originalname);
              cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
            },
          }),
          limits: {
            fileSize: 10 * 1024 * 1024, // 10MB
          },
        };
      },
    }),
  ],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
