import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateJobDto } from './dto/create-job.dto';
import { ParseAnalysisJobDto } from './dto/parse-analysis-job.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiScopes('rag:jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  list() {
    return this.jobsService.list();
  }

  @Post()
  @Roles('admin')
  create(@Body() body: CreateJobDto) {
    return this.jobsService.create(body);
  }

  @Post('analysis/parse')
  @Roles('admin')
  parseAnalysis(@Body() body: ParseAnalysisJobDto) {
    return this.jobsService.parseAnalysisDefinition(
      body.sourceText,
      body.sourceType,
    );
  }

  @Post(':id/copy')
  @Roles('admin')
  copy(@Param('id') id: string) {
    return this.jobsService.copy(id);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.jobsService.listVersions(id);
  }

  @Post(':id/run')
  @Roles('admin')
  runNow(@Param('id') id: string) {
    return this.jobsService.runNow(id);
  }

  @Patch(':id/start')
  @Roles('admin')
  start(@Param('id') id: string) {
    return this.jobsService.start(id);
  }

  @Patch(':id/stop')
  @Roles('admin')
  stop(@Param('id') id: string) {
    return this.jobsService.stop(id);
  }

  @Get(':id/executions')
  getExecutions(@Param('id') id: string) {
    return this.jobsService.getExecutions(id);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) {
    return this.jobsService.delete(id);
  }
}
