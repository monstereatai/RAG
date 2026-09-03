/**
 * 一次性令牌存储抽象（邮箱激活 token / 密码重置验证码）
 *
 * 实现方语义约定：
 *  - set(key, value, ttl)：写入并带过期时间；
 *  - get(key)：只读，不消费；
 *  - consume(key)：读取即删除（一次性消费），是激活 / 重置接口的入口；
 *  - delete(key)：显式删除（如重置成功后清理验证码）。
 */
export interface TokenStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  consume(key: string): Promise<string | null>;
}
