import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class FileService {
  async handleFileUpload(file: Express.Multer.File): Promise<any> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Return relative path or full URL depending on your setup
    // For local dev, a relative path is enough. In production, this might be an OSS URL.
    return {
      originalname: file.originalname,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      url: `/uploads/${file.filename}`, // Assuming static serving of /uploads folder
    };
  }
}
