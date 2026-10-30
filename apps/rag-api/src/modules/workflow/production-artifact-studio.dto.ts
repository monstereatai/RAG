import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PRODUCTION_ARTIFACT_TARGETS,
  type ProductionArtifactTarget,
  type ProductionCodeTarget,
  type ProductionSchemaTarget,
} from './production-artifact-studio.service';

export class GenerateProductionArtifactsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PRODUCTION_ARTIFACT_TARGETS, { each: true })
  targets!: ProductionArtifactTarget[];
}

export class ProposeProductionArtifactEditDto {
  @IsIn(['activity-schema', 'dashboard-schema'])
  target!: ProductionSchemaTarget;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  instruction!: string;

  @IsString()
  @MinLength(1)
  baseArtifactId!: string;
}

export class ProposeProductionCodeEditDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  baseArtifactId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  instruction!: string;
}

export class ApplyProductionCodeEditDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  baseArtifactId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  instruction!: string;

  @IsObject()
  files!: Record<string, string>;
}

export class ApplyProductionArtifactEditDto {
  @IsIn(['activity-schema', 'dashboard-schema'])
  target!: ProductionSchemaTarget;

  @IsString()
  @MinLength(1)
  baseArtifactId!: string;

  @IsObject()
  schema!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(
    PRODUCTION_ARTIFACT_TARGETS.filter(
      (target) => target !== 'activity-schema' && target !== 'dashboard-schema',
    ),
    { each: true },
  )
  regenerateTargets?: ProductionCodeTarget[];
}

export class RestoreProductionArtifactVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  artifactId!: string;
}
