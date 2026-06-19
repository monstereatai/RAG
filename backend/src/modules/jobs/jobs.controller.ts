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
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  list() {
    return this.jobsService.list();
  }

  @Post()
  create(@Body() body: CreateJobDto) {
    return this.jobsService.create(body);
  }

  @Patch(':id/start')
  start(@Param('id') id: string) {
    return this.jobsService.start(id);
  }

  @Patch(':id/stop')
  stop(@Param('id') id: string) {
    return this.jobsService.stop(id);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.jobsService.delete(id);
  }
}
