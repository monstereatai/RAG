import { Injectable } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';

@Injectable()
export class AppValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      skipMissingProperties: false,
      skipNullProperties: false,
      validationError: {
        target: false,
        value: false,
      },
    });
  }
}
