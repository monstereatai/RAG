import { ApiProperty } from '@nestjs/swagger';

export class LoginVo {
  @ApiProperty({ description: '访问令牌（短效）', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  access_token: string;

  @ApiProperty({ description: '刷新令牌（长效）', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refresh_token: string;

  @ApiProperty({ description: '令牌类型', example: 'Bearer' })
  token_type: string;
}
