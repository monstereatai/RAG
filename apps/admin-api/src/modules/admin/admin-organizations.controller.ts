import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@ApiTags('admin/organizations')
@ApiBearerAuth()
@Controller('admin/organizations')
export class AdminOrganizationsController {
  @Get()
  @ApiOperation({ summary: '获取组织树（管理后台脱敏默认数据）' })
  @RequirePermission('admin:documents:read')
  getOrganizations() {
    const departments = [
      { id: 'dept-finance', name: '财务部', parentId: null },
      { id: 'dept-legal', name: '法务部', parentId: null },
      { id: 'dept-cs', name: '客户成功部', parentId: null },
      { id: 'dept-security', name: '安全部', parentId: null },
    ];
    const positions = [
      { id: 'pos-finance-owner', name: '财务负责人', departmentId: 'dept-finance' },
      { id: 'pos-legal-owner', name: '法务负责人', departmentId: 'dept-legal' },
      { id: 'pos-duty-manager', name: '值班经理', departmentId: 'dept-cs' },
      {
        id: 'pos-security-reviewer',
        name: '安全审批人',
        departmentId: 'dept-security',
      },
    ];

    return {
      data: {
        departments,
        positions,
        tree: departments.map((department) => ({
          ...department,
          positions: positions.filter(
            (position) => position.departmentId === department.id,
          ),
        })),
      },
    };
  }
}
