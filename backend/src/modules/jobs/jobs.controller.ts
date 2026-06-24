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
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
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
