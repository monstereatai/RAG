import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

/**
 * 团队/部门组织架构（admin 后台）。
 * 团队 CRUD + 成员管理（添加成员时校验 userId 存在）。
 */
@ApiTags('admin/teams')
@ApiBearerAuth()
@Controller('admin/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @ApiOperation({ summary: '团队列表（支持按名称筛选 + 分页）' })
  @RequirePermission('admin:team:read')
  async findAll(@Query() query: any) {
    const teams = await this.teamsService.listTeams();
    const page = Number(query.current) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const start = (page - 1) * pageSize;
    const filtered = query.name
      ? teams.filter(team => team.name?.includes(query.name))
      : teams;
    return {
      data: filtered.slice(start, start + pageSize),
      total: filtered.length,
    };
  }

  @Post()
  @AuditLog('teams', 'create')
  @ApiOperation({ summary: '创建团队' })
  @RequirePermission('admin:team:create')
  create(@Body() createTeamDto: CreateTeamDto) {
    return this.teamsService.createTeam(createTeamDto);
  }

  @Patch(':id')
  @AuditLog('teams', 'update')
  @ApiOperation({ summary: '更新团队' })
  @RequirePermission('admin:team:update')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateTeamDto: UpdateTeamDto) {
    return this.teamsService.updateTeam(id, updateTeamDto);
  }

  @Delete(':id')
  @AuditLog('teams', 'delete')
  @ApiOperation({ summary: '删除团队（级联删除成员关系）' })
  @RequirePermission('admin:team:delete')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.teamsService.deleteTeam(id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: '团队成员列表' })
  @RequirePermission('admin:team:read')
  listMembers(@Param('id', ParseIntPipe) id: number) {
    return this.teamsService.listMembers(id);
  }

  @Post(':id/members')
  @AuditLog('teams', 'add-member')
  @ApiOperation({ summary: '添加团队成员（校验 userId 存在）' })
  @RequirePermission('admin:team:update')
  addMember(@Param('id', ParseIntPipe) id: number, @Body() addTeamMemberDto: AddTeamMemberDto) {
    return this.teamsService.addMember(id, addTeamMemberDto);
  }

  @Delete(':id/members/:userId')
  @AuditLog('teams', 'remove-member')
  @ApiOperation({ summary: '移除团队成员' })
  @RequirePermission('admin:team:update')
  removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<void> {
    return this.teamsService.removeMember(id, userId);
  }
}
