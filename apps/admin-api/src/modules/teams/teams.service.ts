import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from '../../database/entities/team.entity';
import { TeamMember } from '../../database/entities/team-member.entity';
import { User } from '../../database/entities/user.entity';
import { UserService } from '../user/user.service';
import { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';

/** 团队列表条目（附带成员数） */
export interface TeamWithCount extends Team {
  memberCount: number;
}

/** 成员列表条目（附带用户信息，便于前端展示） */
export interface TeamMemberItem {
  id: number;
  teamId: number;
  userId: number;
  username: string;
  email: string;
  role: string;
  joinedAt: Date;
}

@Injectable()
export class TeamsService {
  // 内存模式兜底（与 PermissionService/UserService 的约定一致）：ENABLE_DATABASE=false 时可用
  private teams: Team[] = [];
  private members: TeamMember[] = [];
  private nextTeamId = 1;
  private nextMemberId = 1;

  constructor(
    @Optional()
    @InjectRepository(Team)
    private readonly teamRepository?: Repository<Team>,
    @Optional()
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository?: Repository<TeamMember>,
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>,
    // 复用 UserService 做「用户是否存在」校验（内存模式下用户数据在其内部数组里）
    @Optional()
    private readonly userService?: UserService,
  ) {}

  /** 批量查询用户（数据库模式一次查库；内存模式走 UserService） */
  private async findUsersByIds(userIds: number[]): Promise<Array<Pick<User, 'id' | 'username' | 'email'>>> {
    const ids = Array.from(new Set(userIds));
    if (ids.length === 0) {
      return [];
    }
    if (this.userRepository) {
      return this.userRepository.find({ where: ids.map(id => ({ id })) });
    }
    const users = await Promise.all(ids.map(id => this.userService?.findOne(id)));
    return users.filter(Boolean) as Array<User>;
  }

  /** 校验用户存在，不存在抛 BadRequestException */
  private async assertUserExists(userId: number): Promise<void> {
    const users = await this.findUsersByIds([userId]);
    if (users.length === 0) {
      throw new BadRequestException(`用户 ${userId} 不存在，无法添加为团队成员`);
    }
  }

  // ==========================================================================
  // 团队 CRUD
  // ==========================================================================

  async listTeams(): Promise<TeamWithCount[]> {
    if (!this.teamRepository) {
      return this.teams.map(team => ({
        ...team,
        memberCount: this.members.filter(member => member.teamId === team.id).length,
      }));
    }

    const teams = await this.teamRepository.find();
    const countRows = await this.teamMemberRepository!
      .createQueryBuilder('member')
      .select('member.teamId', 'teamId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('member.teamId')
      .getRawMany();
    const countMap = new Map(countRows.map(row => [Number(row.teamId), Number(row.count)]));

    return teams.map(team => ({ ...team, memberCount: countMap.get(team.id) ?? 0 }));
  }

  async createTeam(createTeamDto: CreateTeamDto): Promise<Team> {
    if (!this.teamRepository) {
      if (this.teams.some(team => team.name === createTeamDto.name)) {
        throw new ConflictException('团队名称已存在');
      }
      const now = new Date();
      const team = {
        id: this.nextTeamId++,
        description: null,
        ...createTeamDto,
        createdAt: now,
        updatedAt: now,
      } as Team;
      this.teams.push(team);
      return team;
    }

    const existing = await this.teamRepository.findOne({ where: { name: createTeamDto.name } });
    if (existing) {
      throw new ConflictException('团队名称已存在');
    }

    const team = this.teamRepository.create(createTeamDto);
    return await this.teamRepository.save(team);
  }

  async findOne(id: number): Promise<Team> {
    if (!this.teamRepository) {
      const team = this.teams.find(item => item.id === Number(id));
      if (!team) {
        throw new NotFoundException(`Team with ID ${id} not found`);
      }
      return team;
    }

    const team = await this.teamRepository.findOne({ where: { id: Number(id) } });
    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found`);
    }
    return team;
  }

  async updateTeam(id: number, updateTeamDto: UpdateTeamDto): Promise<Team> {
    const team = await this.findOne(id);

    if (updateTeamDto.name && updateTeamDto.name !== team.name) {
      const duplicate = this.teamRepository
        ? await this.teamRepository.findOne({ where: { name: updateTeamDto.name } })
        : this.teams.find(item => item.name === updateTeamDto.name);
      if (duplicate && duplicate.id !== team.id) {
        throw new ConflictException('团队名称已存在');
      }
    }

    Object.assign(team, updateTeamDto);

    if (!this.teamRepository) {
      return team;
    }
    return await this.teamRepository.save(team);
  }

  async deleteTeam(id: number): Promise<void> {
    const team = await this.findOne(id);

    if (!this.teamRepository) {
      this.teams = this.teams.filter(item => item.id !== team.id);
      this.members = this.members.filter(member => member.teamId !== team.id);
      return;
    }

    // 先删成员再删团队（迁移里虽有 FK ON DELETE CASCADE，显式删除语义更清晰）
    await this.teamMemberRepository!.delete({ teamId: team.id });
    await this.teamRepository.delete(team.id);
  }

  // ==========================================================================
  // 团队成员管理
  // ==========================================================================

  async listMembers(teamId: number): Promise<TeamMemberItem[]> {
    await this.findOne(teamId); // 团队不存在时抛 404

    let members: TeamMember[];
    if (!this.teamMemberRepository) {
      members = this.members.filter(member => member.teamId === Number(teamId));
    } else {
      members = await this.teamMemberRepository.find({ where: { teamId: Number(teamId) } });
    }

    const users = await this.findUsersByIds(members.map(member => member.userId));
    const userMap = new Map(users.map(user => [Number(user.id), user]));

    return members.map(member => ({
      id: member.id,
      teamId: member.teamId,
      userId: member.userId,
      username: userMap.get(member.userId)?.username ?? `用户${member.userId}`,
      email: userMap.get(member.userId)?.email ?? '',
      role: member.role,
      joinedAt: member.joinedAt,
    }));
  }

  async addMember(teamId: number, addTeamMemberDto: AddTeamMemberDto): Promise<TeamMemberItem> {
    const team = await this.findOne(teamId);
    const userId = Number(addTeamMemberDto.userId);
    await this.assertUserExists(userId);

    const role = addTeamMemberDto.role ?? 'member';

    if (!this.teamMemberRepository) {
      if (this.members.some(member => member.teamId === team.id && member.userId === userId)) {
        throw new ConflictException('该用户已是团队成员');
      }
      const member = {
        id: this.nextMemberId++,
        teamId: team.id,
        userId,
        role,
        joinedAt: new Date(),
      } as TeamMember;
      this.members.push(member);
      const users = await this.findUsersByIds([userId]);
      return this.toMemberItem(member, users[0]);
    }

    const existing = await this.teamMemberRepository.findOne({ where: { teamId: team.id, userId } });
    if (existing) {
      throw new ConflictException('该用户已是团队成员');
    }

    const member = await this.teamMemberRepository.save({ teamId: team.id, userId, role } as TeamMember);
    const user = await this.findUsersByIds([userId]);
    return this.toMemberItem(member, user[0]);
  }

  async removeMember(teamId: number, userId: number): Promise<void> {
    await this.findOne(teamId); // 团队不存在时抛 404

    if (!this.teamMemberRepository) {
      const before = this.members.length;
      this.members = this.members.filter(
        member => !(member.teamId === Number(teamId) && member.userId === Number(userId)),
      );
      if (this.members.length === before) {
        throw new NotFoundException('该用户不是团队成员');
      }
      return;
    }

    const member = await this.teamMemberRepository.findOne({
      where: { teamId: Number(teamId), userId: Number(userId) },
    });
    if (!member) {
      throw new NotFoundException('该用户不是团队成员');
    }
    await this.teamMemberRepository.delete(member.id);
  }

  private toMemberItem(
    member: { id: number; teamId: number; userId: number; role: string; joinedAt: Date },
    user?: { id?: number; username?: string; email?: string },
  ): TeamMemberItem {
    return {
      id: member.id,
      teamId: member.teamId,
      userId: member.userId,
      username: user?.username ?? `用户${member.userId}`,
      email: user?.email ?? '',
      role: member.role,
      joinedAt: member.joinedAt,
    };
  }
}
