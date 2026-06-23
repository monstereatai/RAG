import { Injectable, UnauthorizedException } from '@nestjs/common';

interface LoginAttemptState {
  failedCount: number;
  lockedUntil: number | null;
  lastFailedAt: string | null;
}

@Injectable()
export class AccountSecurityService {
  private readonly maxFailedAttempts = 5;
  private readonly lockMinutes = 15;
  private readonly attempts = new Map<string, LoginAttemptState>();

  getPolicy() {
    return {
      accountLock: {
        enabled: true,
        storage: 'memory',
        maxFailedAttempts: this.maxFailedAttempts,
        lockMinutes: this.lockMinutes,
        persistence: false,
      },
      forgotPassword: {
        enabled: false,
        blocker: '需要邮件/短信通道和 token 持久化，涉及外部服务与数据库 schema，暂不执行。',
      },
      mfa: {
        enabled: false,
        blocker: '需要 MFA secret/backup codes 持久化，涉及数据库 schema，暂不执行。',
      },
    };
  }

  getAttemptStatus(username?: string) {
    if (!username) {
      return {
        trackedUsers: this.attempts.size,
        maxFailedAttempts: this.maxFailedAttempts,
        lockMinutes: this.lockMinutes,
      };
    }

    const state = this.getState(username);

    return {
      username,
      failedCount: state.failedCount,
      locked: this.isLocked(state),
      lockedUntil: state.lockedUntil ? new Date(state.lockedUntil).toISOString() : null,
      lastFailedAt: state.lastFailedAt,
    };
  }

  assertCanLogin(username: string) {
    const state = this.getState(username);

    if (this.isLocked(state)) {
      throw new UnauthorizedException('账号已被临时锁定，请稍后再试');
    }
  }

  recordLoginFailure(username: string) {
    const state = this.getState(username);
    state.failedCount += 1;
    state.lastFailedAt = new Date().toISOString();

    if (state.failedCount >= this.maxFailedAttempts) {
      state.lockedUntil = Date.now() + this.lockMinutes * 60 * 1000;
    }

    this.attempts.set(username, state);
  }

  recordLoginSuccess(username: string) {
    this.attempts.delete(username);
  }

  requestPasswordReset(usernameOrEmail: string) {
    return {
      accepted: false,
      usernameOrEmail,
      status: 'blocked',
      message: '忘记密码流程需要邮件/短信通道和一次性 token 持久化，当前先不触碰 schema。',
    };
  }

  getMfaStatus(user: unknown) {
    const currentUser = (user && typeof user === 'object' ? user : {}) as Record<string, unknown>;

    return {
      userId: currentUser.userId ?? null,
      username: currentUser.username ?? null,
      enabled: false,
      status: 'blocked',
      message: 'MFA 需要 secret 与 backup codes 持久化，当前先不触碰 schema。',
    };
  }

  startMfaSetup(user: unknown) {
    return this.getMfaStatus(user);
  }

  private getState(username: string): LoginAttemptState {
    const current = this.attempts.get(username);

    if (!current) {
      return {
        failedCount: 0,
        lockedUntil: null,
        lastFailedAt: null,
      };
    }

    if (current.lockedUntil && current.lockedUntil <= Date.now()) {
      return {
        failedCount: 0,
        lockedUntil: null,
        lastFailedAt: current.lastFailedAt,
      };
    }

    return current;
  }

  private isLocked(state: LoginAttemptState) {
    return Boolean(state.lockedUntil && state.lockedUntil > Date.now());
  }
}
