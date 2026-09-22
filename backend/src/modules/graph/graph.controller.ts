import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { GraphService } from './graph.service';
import { GraphExtractDto, GraphImportDto, GraphQueryDto } from './graph.dto';
import { ApiScopes } from '../../common/decorators/api-scopes.decorator';

@Controller('graph')
@UseGuards(JwtAuthGuard)
@ApiScopes('rag:graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Post('extract')
  extract(@Body() body: GraphExtractDto) {
    return this.graphService.extract(body.text);
  }

  @Post('import')
  importText(@Body() body: GraphImportDto, @CurrentUser() user: JwtPayload) {
    return this.graphService.importText(body.text, user.userId, body.sourceId);
  }

  @Post('query')
  query(@Body() body: GraphQueryDto, @CurrentUser() user: JwtPayload) {
    return this.graphService.queryGraph(body.query, user.userId);
  }

  @Get('schema')
  schema(@CurrentUser() user: JwtPayload) {
    return this.graphService.getSchema(user.userId);
  }
}
