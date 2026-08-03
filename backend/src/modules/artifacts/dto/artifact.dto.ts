import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { ArtifactKind } from '../../../providers/db/entities/generated-artifact.entity';
import type { ArtifactShareVisibility } from '../../../providers/db/entities/artifact-share.entity';

export class CreateArtifactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  ownerUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  threadId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title!: string;

  @IsIn(['markdown', 'word', 'excel', 'architecture', 'image'])
  kind!: ArtifactKind;

  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  sourceText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  prompt?: string;
}

export class CreateArtifactShareDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  createdBy!: string;

  @IsIn(['internal', 'external'])
  visibility!: ArtifactShareVisibility;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxDownloads?: number;
}
