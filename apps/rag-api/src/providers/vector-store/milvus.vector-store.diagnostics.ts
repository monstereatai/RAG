import { Logger } from '@nestjs/common';
import { IndexType, MetricType } from '@zilliz/milvus2-sdk-node';
import { DingTalkProvider } from '../notify/dingtalk.provider';
import type {
  VectorIndexInfo,
  VectorStoreRuntimeStatus,
} from './vector-store-provider.interface';

export abstract class MilvusVectorStoreDiagnosticsBase {
  protected abstract readonly logger: Logger;
  protected abstract readonly collection: string;
  protected abstract readonly dimension: number;
  protected abstract readonly imageCollection: string;
  protected abstract readonly imageDimension: number;
  protected abstract readonly indexType: IndexType;
  protected abstract readonly hnswM: number;
  protected abstract readonly hnswEfConstruction: number;
  protected abstract readonly hnswEfSearch: number;
  protected abstract readonly searchTimeoutMs: number;
  protected abstract readonly deleteTimeoutMs: number;
  protected abstract readonly warmupTimeoutMs: number;
  protected abstract readonly circuitOpenMs: number;
  protected abstract readonly circuitFailureThreshold: number;
  protected abstract readonly dingTalk?: DingTalkProvider;
  protected abstract connected: boolean;

  protected circuitOpenUntil = 0;

  protected consecutiveFailures = 0;

  protected lastFailureAt: Date | null = null;

  protected lastFailureMessage: string | null = null;

  getIndexInfo(): VectorIndexInfo {
    return {
      provider: 'milvus',
      collection: this.collection,
      dimension: this.dimension,
      indexType: this.indexType,
      metricType: MetricType.COSINE,
      params: {
        M: this.hnswM,
        efConstruction: this.hnswEfConstruction,
        ef: this.hnswEfSearch,
        searchTimeoutMs: this.searchTimeoutMs,
        deleteTimeoutMs: this.deleteTimeoutMs,
        warmupTimeoutMs: this.warmupTimeoutMs,
        circuitOpenMs: this.circuitOpenMs,
        circuitFailureThreshold: this.circuitFailureThreshold,
      },
    };
  }

  getImageCollectionInfo(): {
    collection: string;
    dimension: number;
    indexType: IndexType;
  } {
    return {
      collection: this.imageCollection,
      dimension: this.imageDimension,
      indexType: this.indexType,
    };
  }

  getRuntimeStatus(): VectorStoreRuntimeStatus {
    const circuitState = this.getCircuitState();
    const available = this.connected && circuitState !== 'open';
    const status = !this.connected
      ? 'unavailable'
      : circuitState === 'open' || this.consecutiveFailures > 0
        ? 'degraded'
        : 'healthy';

    return {
      status,
      available,
      circuitState,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      lastFailureMessage: this.lastFailureMessage,
      circuitOpenUntil:
        this.circuitOpenUntil > Date.now()
          ? new Date(this.circuitOpenUntil).toISOString()
          : null,
    };
  }

  protected resolveIndexType(value: string): IndexType {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'HNSW') {
      return IndexType.HNSW;
    }
    this.logger.warn(
      `Unsupported MILVUS_INDEX_TYPE="${value}", fallback to HNSW`,
    );
    return IndexType.HNSW;
  }

  protected getCreateIndexParams(): Record<string, number> {
    return {
      M: this.hnswM,
      efConstruction: this.hnswEfConstruction,
    };
  }

  protected getSearchParams(): Record<string, number> {
    return { ef: this.hnswEfSearch };
  }

  protected isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  protected getCircuitState(): 'closed' | 'open' | 'half_open' {
    if (this.circuitOpenUntil === 0) return 'closed';
    return this.isCircuitOpen() ? 'open' : 'half_open';
  }

  protected recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  protected recordFailure(err: unknown): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = new Date();
    this.lastFailureMessage = this.formatErrorMessage(err);
    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.openCircuit();
    }
  }

  protected formatErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (err === null || err === undefined) return 'unknown error';
    try {
      return JSON.stringify(err);
    } catch {
      return 'unserializable error';
    }
  }

  protected openCircuit(): void {
    this.circuitOpenUntil = Date.now() + this.circuitOpenMs;
    // 钉钉告警（fire-and-forget，节流窗口内同 key 只发一次）
    void this.dingTalk?.notifyAlert(
      'milvus.circuit',
      `**Milvus 熔断打开**（连续失败 ${this.consecutiveFailures} 次，暂停 ${this.circuitOpenMs}ms）\n\n最近错误：${this.lastFailureMessage ?? 'unknown'}`,
    );
  }
}
