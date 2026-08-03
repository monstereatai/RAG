/**
 * BM25 索引的 JSON 持久化工具
 * 将 BM25 内存数据序列化到 workspace/bm25-index.json，重启后自动恢复。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Bm25PersistedEntry {
  id: string;
  content: string;
  docId: string;
  chunkIndex: number;
  tokens: string[];
  userId?: string;
  parentChunkId?: string | null;
  headingPath?: string[];
  sectionId?: string | null;
  clauseId?: string | null;
  tableRef?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: string;
  lifecycleStatus?: string;
  supersedesDocId?: string | null;
}

export interface Bm25PersistedStore {
  version: number;
  updatedAt: string;
  entries: Bm25PersistedEntry[];
}

export class Bm25Store {
  private readonly filePath: string;

  constructor(workspaceDir: string) {
    this.filePath = path.join(workspaceDir, 'bm25-index.json');
    // 确保目录存在
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  /**
   * 读取持久化存储。不存在时返回 null。
   */
  load(): Bm25PersistedStore | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Bm25PersistedStore;
      if (parsed.version !== 1) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * 将当前内存数据写入磁盘（覆盖）
   */
  save(entries: Bm25PersistedEntry[]): void {
    const store: Bm25PersistedStore = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries,
    };
    fs.writeFileSync(this.filePath, JSON.stringify(store), 'utf-8');
  }

  /**
   * 删除指定 docId 的所有条目并保存
   */
  removeByDocId(
    currentEntries: Bm25PersistedEntry[],
    docId: string,
  ): Bm25PersistedEntry[] {
    const filtered = currentEntries.filter((e) => e.docId !== docId);
    this.save(filtered);
    return filtered;
  }

  getFilePath(): string {
    return this.filePath;
  }
}
