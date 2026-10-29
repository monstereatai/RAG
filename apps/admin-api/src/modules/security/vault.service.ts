import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);

  async onModuleInit() {
    await this.loadSecrets();
  }

  /**
   * 从 HashiCorp Vault 动态拉取配置并注入到 process.env
   * 
   * 本地启动并测试 Vault 容器命令：
   *   docker run -d --name=vault -p 8200:8200 -e 'VAULT_DEV_ROOT_TOKEN_ID=my-token' hashicorp/vault
   * 
   * 写入测试密钥：
   *   docker exec -it vault vault kv put secret/nestjs-app DB_PASSWORD="vault_db_pwd_456" JWT_SECRET="vault_jwt_secret_min_32_chars_long"
   */
  async loadSecrets(): Promise<void> {
    const vaultAddr = process.env.VAULT_ADDR;
    const vaultToken = process.env.VAULT_TOKEN;

    if (!vaultAddr || !vaultToken) {
      this.logger.warn('未配置 VAULT_ADDR 或 VAULT_TOKEN，跳过 HashiCorp Vault 动态密钥拉取，使用本地 env 配置。');
      return;
    }

    try {
      this.logger.log(`正在连接 HashiCorp Vault: ${vaultAddr}...`);
      
      // 拼接 Vault KV V2 引擎默认路径 (默认 secret/data/nestjs-app)
      const secretPath = process.env.VAULT_SECRET_PATH || 'secret/data/nestjs-app';
      const url = `${vaultAddr}/v1/${secretPath}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Vault-Token': vaultToken,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Vault 返回 HTTP 错误: ${response.status} ${response.statusText}`);
      }

      const body: any = await response.json();
      const secrets = body?.data?.data;

      if (secrets && typeof secrets === 'object') {
        let loadedCount = 0;
        for (const [key, value] of Object.entries(secrets)) {
          if (value !== undefined && value !== null) {
            process.env[key] = String(value);
            loadedCount++;
          }
        }
        this.logger.log(`成功从 Vault 动态加载并覆盖了 ${loadedCount} 个配置密钥！`);
      } else {
        this.logger.warn('从 Vault 读取的 Secrets 数据结构为空，请检查 secretPath 是否正确写入。');
      }
    } catch (error: any) {
      this.logger.error(`从 Vault 动态拉取密钥失败: ${error.message}。系统将回退使用本地默认配置。`);
    }
  }
}
