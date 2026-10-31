import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateApiTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsDateString({ strict: true })
  @MaxLength(64)
  expiresAt?: string;
}

export interface ApiTokenRecordView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface CreateApiTokenResponse extends ApiTokenRecordView {
  token: string;
  tokenType: 'Bearer';
}
