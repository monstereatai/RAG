import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserEntity } from "../../providers/db/entities/user.entity";
import type { AuthUserRecord } from "./auth-user.store";

/**
 * 将认证存储中的用户镜像到 PostgreSQL users 表。
 * 文档 ACL、团队空间和租户过滤依赖 users 表，注册/登录/刷新/改密时同步。
 */
@Injectable()
export class AuthIdentitySyncService {
  private readonly logger = new Logger(AuthIdentitySyncService.name);

  constructor(
    @Optional()
    @InjectRepository(UserEntity)
    private readonly userRepo?: Repository<UserEntity>,
  ) {}

  async sync(
    user: AuthUserRecord,
    options: { required?: boolean } = {},
  ): Promise<void> {
    if (this.userRepo == null) {
      if (options.required) {
        throw new Error("users repository is unavailable for identity sync");
      }
      return;
    }

    const tenantId = user.tenantId?.trim() || "legacy";
    const existingById = await this.userRepo.findOneBy({ id: user.id });
    if (existingById) {
      await this.userRepo.update(
        { id: user.id },
        {
          username: user.username,
          passwordHash: user.passwordHash,
          role: user.role,
          tenantId,
        },
      );
      return;
    }

    const existingByName = await this.userRepo.findOneBy({
      username: user.username,
    });
    if (existingByName && existingByName.id != user.id) {
      throw new Error(
        "users table already contains the username with a different id",
      );
    }

    try {
      await this.userRepo.insert({
        id: user.id,
        username: user.username,
        passwordHash: user.passwordHash,
        role: user.role,
        tenantId,
      });
    } catch (error) {
      const concurrent = await this.userRepo.findOneBy({ id: user.id });
      if (concurrent == null) {
        this.logger.error(
          "identity sync failed for " +
            user.username +
            ": " +
            (error as Error).message,
        );
        if (options.required) throw error;
      }
    }
  }
}
