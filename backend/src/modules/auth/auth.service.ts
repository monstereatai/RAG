import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { JwtPayload } from '../../common/interfaces/api-response.interface';
import { MailService } from '../mail/mail.service';
import { AuthUserRecord, AuthUserStore } from './auth-user.store';
import { TokenStoreService } from './token-store/token-store.service';
import { LoginDto, LoginResponse } from './dto/login.dto';
import type { RegisterDto, RegisterResponse } from './dto/register.dto';
import type {
  PasswordResetCodeDto,
  PasswordResetCodeResponse,
  PasswordResetDto,
  PasswordResetResponse,
  VerifyEmailResponse,
} from './dto/password-reset.dto';
import {
  buildActivationEmailHtml,
  buildPasswordResetCodeHtml,
} from './mail-templates';
import { IamService } from '../iam/iam.service';

/** access token 默认有效期（JWT_ACCESS_EXPIRES 未配置时） */
const DEFAULT_ACCESS_EXPIRES_IN = '2h';

/** refresh token 默认有效期（JWT_REFRESH_EXPIRES 未配置时） */
const DEFAULT_REFRESH_EXPIRES_IN = '7d';

/** 邮箱激活 token 有效期：24h */
const ACTIVATION_TOKEN_TTL_SECONDS = 24 * 3600;

/** 密码重置验证码有效期：10 分钟 */
const PASSWORD_RESET_CODE_TTL_SECONDS = 10 * 60;

/** 发码防枚举统一文案（邮箱存在与否返回一致，不暴露注册状态） */
const PASSWORD_RESET_CODE_DISPATCHED_MESSAGE =
  '如果该邮箱已注册，重置验证码已发送，请在 10 分钟内查收并完成重置';

/**
 * 认证服务（双 token + 注册激活 + 验证码重置密码）
 *
 * 签发 access / refresh 两种 token：
 *   - access：短有效期（默认 2h），用于访问业务接口（JwtAuthGuard 放行）
 *   - refresh：长有效期（默认 7d），仅用于 POST /auth/refresh 换发新双 token
 *
 * 用户存储：AuthUserStore（Redis 共享 JSON，开发环境才降级到
 * workspace/auth-users.json，原硬编码测试账号保留为种子）；一次性 token 走 TokenStoreService
 * （Redis 可用走 Redis，不可用降级进程内存）；邮件经 MailService
 * （未配置 SMTP 时本地模拟写入 workspace/mail-outbox/latest.json）。
 * 种子账号：admin / admin123（admin），user / user1234（user）。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** DI 注入的用户存储（未注入时懒加载默认实现，保持手工构造兼容） */
  private userStoreRef?: AuthUserStore;
  private tokenStoreRef?: TokenStoreService;
  private mailServiceRef?: MailService;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() injectedUserStore?: AuthUserStore,
    @Optional() injectedTokenStore?: TokenStoreService,
    @Optional() injectedMailService?: MailService,
    @Optional() private readonly iamService?: IamService,
  ) {
    this.userStoreRef = injectedUserStore;
    this.tokenStoreRef = injectedTokenStore;
    this.mailServiceRef = injectedMailService;
  }

  private get userStore(): AuthUserStore {
    this.userStoreRef ??= new AuthUserStore(this.configService);
    return this.userStoreRef;
  }

  private get tokenStore(): TokenStoreService {
    this.tokenStoreRef ??= new TokenStoreService();
    return this.tokenStoreRef;
  }

  private get mailService(): MailService {
    this.mailServiceRef ??= new MailService(this.configService);
    return this.mailServiceRef;
  }

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.userStore.findByUsername(dto.username);
    if (
      !user ||
      !AuthUserStore.verifyPassword(dto.password, user.passwordHash)
    ) {
      throw new UnauthorizedException('invalid username or password');
    }

    // 先验口令再验激活状态：不向未持有正确口令的人泄露账号激活进度
    if (this.requireEmailVerified && !user.emailVerified) {
      throw new ForbiddenException(
        'email not verified: please activate your account via the verification email',
      );
    }

    await this.syncIamMembership(user);
    return this.issueTokenPair(this.toPayload(user));
  }

  /**
   * 注册新用户并发送激活邮件
   *
   * 流程：用户名 / 邮箱查重 → 建用户（emailVerified=false）
   * → 生成一次性激活 token 存 TokenStore（24h）→ 发送激活邮件。
   * 邮件在未配置 SMTP 时走本地模拟（写入 workspace/mail-outbox/latest.json），
   * 不阻塞注册流程；真实 SMTP 发送失败则向上抛出。
   */
  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const username = dto.username.trim();
    const email = dto.email.trim().toLowerCase();

    if (await this.userStore.findByUsername(username)) {
      throw new ConflictException('username already exists');
    }
    if (await this.userStore.findByEmail(email)) {
      throw new ConflictException('email already registered');
    }

    const user = await this.userStore.createUser({
      username,
      email,
      passwordHash: AuthUserStore.hashPassword(dto.password),
      realName: dto.realName,
    });

    const activationToken = randomBytes(32).toString('base64url');
    await this.tokenStore.set(
      this.activationTokenKey(activationToken),
      user.id,
      ACTIVATION_TOKEN_TTL_SECONDS,
    );

    // 全局前缀 api + URI 版本 v1（见 main.ts），激活链接需与之保持一致
    const verifyUrl = `${this.emailLinkBaseUrl}/api/v1/auth/verify-email?token=${activationToken}`;
    await this.mailService.sendMail({
      to: user.email,
      subject: '【企业知识库】邮箱激活验证',
      html: buildActivationEmailHtml(user.username, verifyUrl),
    });

    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      realName: user.realName,
      emailVerified: user.emailVerified,
      message: '注册成功，激活邮件已发送，请在 24 小时内完成邮箱验证',
    };
  }

  /**
   * 邮箱激活：GET /auth/verify-email?token=xxx
   *
   * 原子消费激活 token（读取即删除，防重放），置 emailVerified=true。
   * 已激活用户重复点击旧链接时返回 alreadyVerified=true（幂等）。
   */
  async verifyEmail(token: string): Promise<VerifyEmailResponse> {
    if (!token) {
      throw new BadRequestException('verification token is required');
    }
    const userId = await this.tokenStore.consume(
      this.activationTokenKey(token),
    );
    const user = userId ? await this.userStore.findById(userId) : null;
    if (!user) {
      throw new BadRequestException('activation token invalid or expired');
    }
    if (!user.emailVerified) {
      await this.userStore.markEmailVerified(user.id);
    }
    return {
      verified: true,
      alreadyVerified: user.emailVerified,
      username: user.username,
      email: user.email,
    };
  }

  /**
   * 发送密码重置验证码：POST /auth/password/reset-code
   *
   * 6 位数字验证码存 TokenStore（10 分钟），经 MailService 发送；
   * 邮箱不存在时返回与成功一致的响应体，防止枚举注册邮箱。
   */
  async sendPasswordResetCode(
    dto: PasswordResetCodeDto,
  ): Promise<PasswordResetCodeResponse> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userStore.findByEmail(email);
    if (user) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await this.tokenStore.set(
        this.passwordResetCodeKey(email),
        code,
        PASSWORD_RESET_CODE_TTL_SECONDS,
      );
      await this.mailService.sendMail({
        to: email,
        subject: '【企业知识库】密码重置验证码',
        html: buildPasswordResetCodeHtml(code),
      });
    }
    return {
      sent: true,
      message: PASSWORD_RESET_CODE_DISPATCHED_MESSAGE,
    };
  }

  /**
   * 验证码重置密码：POST /auth/password/reset
   *
   * 校验通过即更新口令并删除验证码（一次性），随后可用新密码登录。
   */
  async resetPassword(dto: PasswordResetDto): Promise<PasswordResetResponse> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userStore.findByEmail(email);
    const storedCode = await this.tokenStore.get(
      this.passwordResetCodeKey(email),
    );
    if (!user || !storedCode || !this.codeMatches(storedCode, dto.code)) {
      throw new BadRequestException('reset code invalid or expired');
    }

    await this.userStore.updatePassword(
      user.id,
      AuthUserStore.hashPassword(dto.newPassword),
    );
    await this.tokenStore.delete(this.passwordResetCodeKey(email));
    return { reset: true, message: '密码已重置，请使用新密码登录' };
  }

  /**
   * 使用 refresh token 换发新的双 token（轮换）
   *
   * 校验链：验签（refresh 密钥）→ payload.type 必须为 refresh
   * → 用户仍存在且未禁用，任一步失败均返回 401。
   */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('refresh token invalid or expired');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('refresh token type invalid');
    }

    // 校验用户仍存在（未来接入禁用状态时在此扩展），且 username 与签发时一致
    const user = await this.userStore.findById(payload.userId);
    if (!user || user.username !== payload.username) {
      throw new UnauthorizedException('user not found or disabled');
    }

    await this.syncIamMembership(user);
    return this.issueTokenPair(this.toPayload(user));
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('token invalid or expired');
    }
  }

  /** 验证码比对（timingSafeEqual 防时序侧信道；长度不一致直接判否） */
  private codeMatches(stored: string, provided: string): boolean {
    const left = Buffer.from(stored, 'utf8');
    const right = Buffer.from(provided, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  /** JwtPayload 组装（双 token 共用的基础声明） */
  private toPayload(user: AuthUserRecord): JwtPayload {
    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      // Membership provisioning falls back to `legacy`; the JWT must use the
      // same tenant or AUTH_REQUIRE_TENANT_CONTEXT will reject the new token.
      tenantId: user.tenantId?.trim() || 'legacy',
    };
  }

  /**
   * 登录／刷新时把认证用户同步到正式 IAM 成员表。
   * 认证存储仍可渐进迁移，但业务请求不再依赖 JWT 中的 role 作为唯一授权依据。
   */
  private async syncIamMembership(user: AuthUserRecord): Promise<void> {
    if (!this.iamService) return;
    const tenantId = user.tenantId?.trim() || 'legacy';
    await this.iamService.ensureMembership(
      user.id,
      tenantId,
      user.role === 'admin' ? 'admin' : 'reader',
    );
    this.logger.debug(`IAM membership ensured for ${user.id}:${tenantId}`);
  }

  /** 激活 token 的存储 key：email:activation:token:{token} → userId */
  private activationTokenKey(token: string): string {
    return `email:activation:token:${token}`;
  }

  /** 重置验证码的存储 key：email:password:reset:{email} → 6 位数字 */
  private passwordResetCodeKey(email: string): string {
    return `email:password:reset:${email.toLowerCase()}`;
  }

  /** 登录是否强制邮箱已激活（AUTH_REQUIRE_EMAIL_VERIFIED=false 可关闭，默认强制） */
  private get requireEmailVerified(): boolean {
    return (
      this.configService.get<string>('AUTH_REQUIRE_EMAIL_VERIFIED') !== 'false'
    );
  }

  /** 激活链接站点地址（拼接 /api/v1/auth/verify-email），默认本机 3000 端口 */
  private get emailLinkBaseUrl(): string {
    return (
      this.configService.get<string>('AUTH_EMAIL_LINK_BASE_URL') ||
      'http://localhost:3000'
    );
  }

  /**
   * 签发 access + refresh 双 token
   *
   * access 用 JwtModule 主密钥（JWT_SECRET）签发；refresh 优先用
   * JWT_REFRESH_SECRET 独立密钥签发，未配置时回落主密钥，
   * 由 JwtAuthGuard 的 type 校验兜底拒绝。
   */
  private async issueTokenPair(base: JwtPayload): Promise<LoginResponse> {
    const accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES') ??
      DEFAULT_ACCESS_EXPIRES_IN;
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES') ??
      DEFAULT_REFRESH_EXPIRES_IN;

    const accessPayload: JwtPayload = { ...base, type: 'access' };
    const refreshPayload: JwtPayload = { ...base, type: 'refresh' };

    // expiresIn 是环境变量里的自由字符串（如 '2h'/'7d'），与 jsonwebtoken 的
    // StringValue 模板字面量类型不兼容，参照 auth.module.ts 的做法显式断言
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        expiresIn: accessExpiresIn,
      } as unknown as JwtSignOptions),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: refreshExpiresIn,
      } as unknown as JwtSignOptions),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessExpiresIn,
      refreshTokenExpiresIn: refreshExpiresIn,
    };
  }

  /** refresh token 签发/验签密钥：JWT_REFRESH_SECRET 未配置时回落 JWT_SECRET */
  private get refreshSecret(): string {
    return (
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      ''
    );
  }
}
