import { BadRequestException, ConflictException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { UserService } from '../user/user.service';

/**
 * 在无数据库（内存模式）下测试 TeamsService 的核心逻辑。
 * userRepository / teamRepository 均不注入，服务使用内部 in-memory 数组。
 */
describe('TeamsService (in-memory mode)', () => {
  let service: TeamsService;
  let userService: UserService;
  let userId: number;

  beforeEach(async () => {
    userService = new UserService(undefined);
    service = new TeamsService(undefined, undefined, undefined, userService);
    const user = await userService.create({
      username: 'alice',
      password: 'Password@1',
      email: 'alice@test.com',
    });
    userId = user.id;
  });

  describe('团队 CRUD', () => {
    it('创建团队后可以在列表中找到（含成员数 0）', async () => {
      const team = await service.createTeam({ name: '研发部', description: '负责研发' });
      const teams = await service.listTeams();
      expect(teams.length).toBe(1);
      expect(teams[0].name).toBe('研发部');
      expect(teams[0].memberCount).toBe(0);
      expect(team.description).toBe('负责研发');
    });

    it('团队名称重复时抛 ConflictException', async () => {
      await service.createTeam({ name: '研发部' });
      await expect(service.createTeam({ name: '研发部' })).rejects.toThrow(ConflictException);
    });

    it('更新团队描述', async () => {
      const team = await service.createTeam({ name: '研发部' });
      const updated = await service.updateTeam(team.id, { description: '新描述' });
      expect(updated.description).toBe('新描述');
    });

    it('删除团队后成员关系一并清理', async () => {
      const team = await service.createTeam({ name: '研发部' });
      await service.addMember(team.id, { userId });
      await service.deleteTeam(team.id);
      const teams = await service.listTeams();
      expect(teams.length).toBe(0);
      await expect(service.listMembers(team.id)).rejects.toThrow(/not found/);
    });
  });

  describe('成员管理', () => {
    it('添加成员（userId 必须存在），默认角色 member', async () => {
      const team = await service.createTeam({ name: '研发部' });
      const member = await service.addMember(team.id, { userId });
      expect(member.role).toBe('member');
      expect(member.username).toBe('alice');
      const members = await service.listMembers(team.id);
      expect(members.length).toBe(1);
    });

    it('添加 owner 角色', async () => {
      const team = await service.createTeam({ name: '研发部' });
      const member = await service.addMember(team.id, { userId, role: 'owner' });
      expect(member.role).toBe('owner');
    });

    it('userId 不存在时抛 BadRequestException', async () => {
      const team = await service.createTeam({ name: '研发部' });
      await expect(service.addMember(team.id, { userId: 9999 })).rejects.toThrow(BadRequestException);
    });

    it('重复添加同一成员抛 ConflictException', async () => {
      const team = await service.createTeam({ name: '研发部' });
      await service.addMember(team.id, { userId });
      await expect(service.addMember(team.id, { userId })).rejects.toThrow(ConflictException);
    });

    it('移除成员后列表不再包含', async () => {
      const team = await service.createTeam({ name: '研发部' });
      await service.addMember(team.id, { userId });
      await service.removeMember(team.id, userId);
      const members = await service.listMembers(team.id);
      expect(members.length).toBe(0);
    });

    it('移除不存在的成员抛 NotFoundException', async () => {
      const team = await service.createTeam({ name: '研发部' });
      await expect(service.removeMember(team.id, 9999)).rejects.toThrow(/不是团队成员/);
    });
  });
});
