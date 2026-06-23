import { SecurityService } from './security.service';

describe('SecurityService', () => {
  let service: SecurityService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new SecurityService();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('validatePassword', () => {
    it('强密码通过校验', () => {
      const result = service.validatePassword('Password@123');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('短于8位时报错', () => {
      const result = service.validatePassword('Ab1@');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('密码长度必须至少8位');
    });

    it('缺少大写字母时报错', () => {
      const result = service.validatePassword('password@123');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('大写'))).toBe(true);
    });

    it('缺少特殊字符时报错', () => {
      const result = service.validatePassword('Password123');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('特殊字符'))).toBe(true);
    });
  });

  describe('validateQueryParams', () => {
    it('正常参数通过', () => {
      expect(service.validateQueryParams({ name: 'alice', page: '1' })).toBe(true);
    });

    it('包含 union select 时拒绝', () => {
      expect(service.validateQueryParams({ q: 'UNION SELECT * FROM users' })).toBe(false);
    });

    it('包含 drop table 时拒绝', () => {
      expect(service.validateQueryParams({ q: 'DROP TABLE users' })).toBe(false);
    });

    it('包含 <script> 时拒绝', () => {
      expect(service.validateQueryParams({ input: '<script>alert(1)</script>' })).toBe(false);
    });

    it('null 或非对象时返回 false', () => {
      expect(service.validateQueryParams(null)).toBe(false);
      expect(service.validateQueryParams('string')).toBe(false);
    });
  });

  describe('encryptData / decryptData', () => {
    it('加密后可以正确解密还原原文', () => {
      const plaintext = 'sensitive-user-data';
      const { iv, encryptedData } = service.encryptData(plaintext);
      const decrypted = service.decryptData(encryptedData, iv);
      expect(decrypted).toBe(plaintext);
    });

    it('两次加密同一文本产生不同密文（随机 IV）', () => {
      const { encryptedData: c1 } = service.encryptData('hello');
      const { encryptedData: c2 } = service.encryptData('hello');
      // IV 不同，密文应不同（概率极低相同）
      expect(c1).not.toBe(c2);
    });
  });
});
