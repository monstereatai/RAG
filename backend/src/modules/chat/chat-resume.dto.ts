import { IsString, IsIn, IsOptional } from 'class-validator';

export class ChatResumeDto {
  @IsString()
  threadId!: string;

  @IsIn(['approved', 'rejected'])
  approval!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  feedback?: string;
}
