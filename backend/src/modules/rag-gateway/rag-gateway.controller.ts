import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { RagContextDto, RagSearchDto } from './rag-gateway.dto';
import { RagGatewayService } from './rag-gateway.service';

@Controller('rag')
@UseGuards(JwtAuthGuard)
export class RagGatewayController {
  constructor(private readonly ragGatewayService: RagGatewayService) {}

  @Post('search')
  search(@Body() body: RagSearchDto, @CurrentUser() user: JwtPayload) {
    return this.ragGatewayService.search(body, user.userId);
  }

  @Post('context')
  context(@Body() body: RagContextDto, @CurrentUser() user: JwtPayload) {
    return this.ragGatewayService.context(body, user.userId);
  }
}
