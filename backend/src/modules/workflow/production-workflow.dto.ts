import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PRODUCTION_ROLES,
  type ProductionRole,
} from './production-workflow.state';

export class StartProductionWorkflowDto {
  @IsOptional()
  @IsUUID()
  threadId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  projectId!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(50_000)
  brief!: string;

  @IsOptional()
  @IsInt()
  @Min(6)
  @Max(30)
  maxSteps?: number;

  @IsOptional()
  @IsIn(['auto', 'required', 'risk_based'])
  approvalMode?: 'auto' | 'required' | 'risk_based';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PRODUCTION_ROLES, { each: true })
  roles?: ProductionRole[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PRODUCTION_ROLES, { each: true })
  approvalRoles?: ProductionRole[];

  @IsOptional()
  @IsIn(['medium', 'high'])
  riskApprovalThreshold?: 'medium' | 'high';

  @IsOptional()
  @IsIn(['sequential', 'hierarchical', 'conditional'])
  processType?: 'sequential' | 'hierarchical' | 'conditional';
}

export class ResumeProductionWorkflowDto {
  @IsIn(['approved', 'rejected'])
  approval!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  feedback?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PRODUCTION_ROLES, { each: true })
  rerunRoles?: ProductionRole[];
}
