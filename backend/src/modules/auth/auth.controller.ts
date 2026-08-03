import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiTokenService } from './api-token.service';
import { LoginDto } from './dto/login.dto';
import type { LoginResponse } from './dto/login.dto';
import { CreateApiTokenDto } from './dto/api-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServiceTokenGuard } from '../../common/guards/service-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/api-response.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly apiTokenService: ApiTokenService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile(@CurrentUser() user: JwtPayload): JwtPayload {
    return user;
  }

  @Get('api-tokens')
  @UseGuards(ServiceTokenGuard)
  listApiTokens(@CurrentUser() user: JwtPayload) {
    return this.apiTokenService.listTokens(user);
  }

  @Post('api-tokens')
  @UseGuards(ServiceTokenGuard)
  createApiToken(
    @Body() dto: CreateApiTokenDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.apiTokenService.createToken(dto, user);
  }

  @Delete('api-tokens/:id')
  @UseGuards(ServiceTokenGuard)
  revokeApiToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.apiTokenService.revokeToken(id, user);
  }
}
