import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SkillsService } from './skills.service';

@Controller('skills')
@UseGuards(JwtAuthGuard)
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  list() {
    return this.skillsService.list();
  }

  @Get('match')
  match(@Query('query') query: string, @Query('limit') limit?: string) {
    if (!query || !query.trim()) {
      throw new BadRequestException('query is required');
    }

    const parsedLimit = limit ? Number(limit) : 5;
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive integer');
    }

    return this.skillsService.match(query, parsedLimit);
  }
}
