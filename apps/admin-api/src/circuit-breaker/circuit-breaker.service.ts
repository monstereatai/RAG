import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  halfOpenRequests?: number;
}

export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
  successRate: number;
  totalRequests: number;
}

@Injectable()
export class CircuitBreakerService implements OnModuleInit {
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private defaultOptions: CircuitBreakerOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    halfOpenRequests: 3,
  };

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    console.log('Circuit Breaker Service initialized');
  }

  // 执行带熔断保护的函数
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    options: CircuitBreakerOptions = {}
  ): Promise<T> {
    const state = this.getBreakerState(key);

    if (state.state === 'OPEN') {
      if (Date.now() < state.nextAttemptTime) {
        throw new Error(`Circuit breaker for ${key} is OPEN. Try again in ${(state.nextAttemptTime - Date.now()) / 1000} seconds`);
      } else {
        // 进入半开状态
        const resetTimeout = options.resetTimeout || this.defaultOptions.resetTimeout || 30000;
        this.updateBreakerState(key, { state: 'HALF_OPEN', nextAttemptTime: Date.now() + resetTimeout });
      }
    }

    try {
      // 设置超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), options.timeout || this.defaultOptions.timeout);
      });

      const result = await Promise.race([fn(), timeoutPromise]);

      // 记录成功
      this.recordSuccess(key);
      return result;
    } catch (error) {
      // 记录失败
      this.recordFailure(key);
      throw error;
    }
  }

  // 获取熔断器状态
  getBreakerState(key: string): CircuitBreakerState {
    const state = this.circuitBreakers.get(key);
    if (!state) {
      return this.createInitialState(key);
    }

    // 更新状态
    if (state.state === 'OPEN' && Date.now() >= state.nextAttemptTime) {
      this.updateBreakerState(key, { state: 'HALF_OPEN', nextAttemptTime: Date.now() });
    }

    return state;
  }

  // 强制打开熔断器
  forceOpen(key: string): void {
    this.updateBreakerState(key, {
      state: 'OPEN',
      nextAttemptTime: Date.now() + (this.defaultOptions.resetTimeout || 30000),
      lastFailureTime: Date.now(),
    });
  }

  // 强制关闭熔断器
  forceClose(key: string): void {
    this.updateBreakerState(key, this.createInitialState(key));
  }

  // 获取所有熔断器状态
  getAllStates(): Map<string, CircuitBreakerState> {
    const states = new Map(this.circuitBreakers);

    // 更新状态
    for (const [key, state] of states) {
      if (state.state === 'OPEN' && Date.now() >= state.nextAttemptTime) {
        this.updateBreakerState(key, { state: 'HALF_OPEN', nextAttemptTime: Date.now() });
      }
    }

    return states;
  }

  // 创建初始状态
  private createInitialState(key: string): CircuitBreakerState {
    const state: CircuitBreakerState = {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
      successRate: 100,
      totalRequests: 0,
    };

    this.circuitBreakers.set(key, state);
    return state;
  }

  // 获取熔断器配置
  private getCircuitBreaker(key: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(key)) {
      this.createInitialState(key);
    }
    return this.circuitBreakers.get(key)!;
  }

  // 更新熔断器状态
  private updateBreakerState(key: string, updates: Partial<CircuitBreakerState>): void {
    const current = this.circuitBreakers.get(key) || this.createInitialState(key);
    const state = { ...current, ...updates };

    // 计算成功率
    if (state.totalRequests > 0) {
      state.successRate = (state.successCount / state.totalRequests) * 100;
    }

    this.circuitBreakers.set(key, state);
  }

  // 记录成功
  private recordSuccess(key: string): void {
    const state = this.circuitBreakers.get(key) || this.createInitialState(key);

    state.successCount++;
    state.totalRequests++;

    // 重置失败计数
    if (state.failureCount > 0) {
      state.failureCount = 0;
    }

    // 检查是否应该关闭熔断器
    if (state.state === 'HALF_OPEN') {
      if (state.successCount >= (this.defaultOptions.halfOpenRequests || 3)) {
        this.updateBreakerState(key, {
          state: 'CLOSED',
          successCount: 0,
          failureCount: 0,
        });
      }
    }

    this.circuitBreakers.set(key, state);
  }

  // 记录失败
  private recordFailure(key: string): void {
    const state = this.circuitBreakers.get(key) || this.createInitialState(key);

    state.failureCount++;
    state.totalRequests++;
    state.lastFailureTime = Date.now();

    // 检查是否应该打开熔断器
    if (state.state === 'CLOSED' || state.state === 'HALF_OPEN') {
      const errorRate = (state.failureCount / state.totalRequests) * 100;
      const threshold = this.defaultOptions.errorThresholdPercentage || 50;

      if (errorRate > threshold) {
        this.updateBreakerState(key, {
          state: 'OPEN',
          nextAttemptTime: Date.now() + (this.defaultOptions.resetTimeout || 30000),
        });
      }
    }

    this.circuitBreakers.set(key, state);
  }

  // 获取统计信息
  getStatistics() {
    const stats: any = {};

    for (const [key, state] of this.circuitBreakers) {
      stats[key] = {
        ...state,
        timeUntilReset: state.state === 'OPEN' ? Math.max(0, state.nextAttemptTime - Date.now()) : 0,
      };
    }

    return stats;
  }

  // 清理过期的熔断器状态
  cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时

    for (const [key, state] of this.circuitBreakers) {
      if (now - state.lastFailureTime > maxAge && state.state === 'CLOSED') {
        this.circuitBreakers.delete(key);
      }
    }
  }
}
