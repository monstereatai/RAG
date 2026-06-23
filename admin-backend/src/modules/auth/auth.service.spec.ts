import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

const mockUserService = {
  validateUser: jest.fn(),
  findOne: jest.fn(),
  findByUsername: jest.fn(),
  getPermissionCodes: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn(() => 'mock.jwt.token'),
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key) => {
    if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
    return null;
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('凭证正确时返回去掉 password 的用户对象', async () => {
      const user = { id: 1, username: 'john', password: 'hashed', role: 'user' };
      mockUserService.validateUser.mockResolvedValue(user);

      const result = await service.validateUser('john', 'Password@123');

      expect(result).toEqual({ id: 1, username: 'john', role: 'user' });
      expect(result).not.toHaveProperty('password');
    });

    it('凭证错误时返回 null', async () => {
      mockUserService.validateUser.mockResolvedValue(null);

      const result = await service.validateUser('john', 'wrong');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('返回 access_token 和 token_type', async () => {
      const user = { id: 1, username: 'john', role: 'admin' };

      const result = await service.login(user);

      expect(result).toEqual({
        access_token: 'mock.jwt.token',
        refresh_token: 'mock.jwt.token',
        token_type: 'Bearer',
      });
      expect(mockJwtService.sign).toHaveBeenNthCalledWith(1, {
        sub: 1,
        username: 'john',
        role: 'admin',
        permissions: [],
      });
      expect(mockJwtService.sign).toHaveBeenNthCalledWith(2, 
        { sub: 1, username: 'john' },
        { expiresIn: '7d' }
      );
    });

    it('role 未提供时默认为 user', async () => {
      const user = { id: 2, username: 'jane' };
      await service.login(user as any);

      expect(mockJwtService.sign).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ role: 'user' }),
      );
    });
  });

  describe('refreshToken', () => {
    it('刷新 token 时保留 username 和权限', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 1, username: 'john' });
      mockUserService.findOne.mockResolvedValue({ id: 1, username: 'john', role: 'admin' });
      mockUserService.getPermissionCodes.mockResolvedValue(['admin:role:read']);

      await service.refreshToken('refresh.jwt.token');

      expect(mockJwtService.sign).toHaveBeenNthCalledWith(1, {
        sub: 1,
        username: 'john',
        role: 'admin',
        permissions: ['admin:role:read'],
      });
    });
  });
});
