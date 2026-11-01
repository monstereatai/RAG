#!/usr/bin/env python3
"""Install the 2026-11-01 Agent/RAG recovery+reviewed-golden patch.
Strict anchor validation; no partial writes, no .DS_Store, backups retained.
This script deliberately never migrates a database, touches runtime state or pushes Git.
"""
from __future__ import annotations
import json, shutil, sys
from pathlib import Path

ROOT = Path.cwd()
PACKAGE = Path(__file__).resolve().parent
BASE = 'apps/rag-api/'

ATOMIC_COMMIT = '''  /** Atomic checkpoint publication. TTL=0 means durable until explicit deletion. */
  async commitCheckpointRequired(input: {
    threadId: string;
    checkpointId: string;
    checkpointJson: string;
    metadataJson: string;
    timestampMs: number;
    ttlSeconds: number;
  }): Promise<void> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    if (!Number.isFinite(input.timestampMs) || input.ttlSeconds < 0 || !Number.isInteger(input.ttlSeconds)) {
      throw new Error('invalid checkpoint timestamp or TTL');
    }
    const script = `
      local ttl = tonumber(ARGV[4])
      local function put(key, val)
        if ttl > 0 then redis.call('SET', key, val, 'EX', ttl)
        else redis.call('SET', key, val); redis.call('PERSIST', key) end
      end
      put(KEYS[1], ARGV[1])
      put(KEYS[2], ARGV[2])
      redis.call('ZADD', KEYS[4], tonumber(ARGV[3]), ARGV[5])
      if ttl > 0 then redis.call('EXPIRE', KEYS[4], ttl)
      else redis.call('PERSIST', KEYS[4]) end
      local latest = redis.call('GET', KEYS[3])
      local oldScore = latest and redis.call('ZSCORE', KEYS[4], latest)
      if not oldScore or tonumber(ARGV[3]) >= tonumber(oldScore) then
        put(KEYS[3], ARGV[5])
      end
      return 1
    `;
    try {
      await this.client.eval(script, 4,
        `checkpoint:${input.threadId}:${input.checkpointId}`,
        `checkpoint:metadata:${input.threadId}:${input.checkpointId}`,
        `checkpoint:latest:${input.threadId}`,
        `thread:${input.threadId}`,
        input.checkpointJson, input.metadataJson,
        String(input.timestampMs), String(input.ttlSeconds), input.checkpointId,
      );
    } catch (err) { this.enabled = false; throw err; }
  }

  /** Pending writes for one LangGraph task are either all visible or absent. */
  async commitCheckpointWritesRequired(input: {
    threadId: string;
    checkpointId: string;
    taskId: string;
    entries: string[];
    ttlSeconds: number;
  }): Promise<void> {
    if (!this.enabled) throw new Error('Redis is unavailable');
    if (input.entries.length === 0) return;
    if (input.ttlSeconds < 0 || !Number.isInteger(input.ttlSeconds)) throw new Error('invalid checkpoint TTL');
    const keys = input.entries.map((_, idx) =>
      `writes:${input.threadId}:${input.checkpointId}:${input.taskId}:${idx}`);
    const script = `
      local ttl = tonumber(ARGV[1])
      for i = 1, #KEYS do
        if ttl > 0 then redis.call('SET', KEYS[i], ARGV[i + 1], 'EX', ttl)
        else redis.call('SET', KEYS[i], ARGV[i + 1]); redis.call('PERSIST', KEYS[i]) end
      end
      return #KEYS
    `;
    try {
      await this.client.eval(script, keys.length, ...keys,
        String(input.ttlSeconds), ...input.entries);
    } catch (err) { this.enabled = false; throw err; }
  }

'''

OLD_PUT = '''      // 保存 checkpoint
      await this.write(
        `checkpoint:${threadId}:${checkpointId}`,
        JSON.stringify(checkpoint),
        this.ttl,
      );

      // 保存 metadata
      if (metadata) {
        await this.write(
          `checkpoint:metadata:${threadId}:${checkpointId}`,
          JSON.stringify(metadata),
          this.ttl,
        );
      }

      // 更新 latest pointer
      await this.write(`checkpoint:latest:${threadId}`, checkpointId, this.ttl);

      // 添加到 thread sorted set（按时间戳排序）
      const score = new Date(checkpoint.ts).getTime();
      await this.zadd(`thread:${threadId}`, score, checkpointId);
'''
NEW_PUT = '''      // Single Redis Lua transaction: no visible half-written checkpoint.
      // Also prevents an older concurrent put from regressing the latest pointer.
      await this.redisProvider.commitCheckpointRequired({
        threadId,
        checkpointId,
        checkpointJson: JSON.stringify(checkpoint),
        metadataJson: JSON.stringify(metadata ?? {}),
        timestampMs: new Date(checkpoint.ts).getTime(),
        ttlSeconds: this.ttl,
      });
'''
OLD_WRITES = '''      // 保存每个 write
      for (const [idx, write] of writes.entries()) {
        const pendingWrite = [taskId, ...write];
        await this.write(
          `writes:${threadId}:${checkpointId}:${taskId}:${idx}`,
          JSON.stringify(pendingWrite),
          this.ttl,
        );
      }
'''
NEW_WRITES = '''      await this.redisProvider.commitCheckpointWritesRequired({
        threadId,
        checkpointId,
        taskId,
        entries: writes.map((write) => JSON.stringify([taskId, ...write])),
        ttlSeconds: this.ttl,
      });
'''
OLD_DELETE = '''      // 获取所有 checkpoint IDs
      const checkpointIds = await this.zrange(`thread:${threadId}`, 0, -1);

      // 删除每个 checkpoint 的数据
      for (const checkpointId of checkpointIds) {
        await this.del(`checkpoint:${threadId}:${checkpointId}`);
        await this.del(`checkpoint:metadata:${threadId}:${checkpointId}`);
      }
'''
NEW_DELETE = '''      // First discover every pending write for the thread, including legacy keys.
      // This is a cleanup operation after the workflow has been stopped;
      // concurrent writers must be stopped by the calling orchestration layer.
      const checkpointIds = await this.zrange(`thread:${threadId}`, 0, -1);
      const pendingWriteKeys = await this.keys(`writes:${threadId}:*`);
      for (const key of pendingWriteKeys) await this.del(key);
      for (const checkpointId of checkpointIds) {
        await this.del(`checkpoint:${threadId}:${checkpointId}`);
        await this.del(`checkpoint:metadata:${threadId}:${checkpointId}`);
      }
'''


def replace_exact(text: str, old: str, new: str, path: str) -> str:
    if new in text:
        return text  # idempotent
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: required anchor count={count}, expected 1; no changes made')
    return text.replace(old, new, 1)


def patch_provider(text: str) -> str:
    return replace_exact(text, '  async zrangeRequired(\n', ATOMIC_COMMIT + '  async zrangeRequired(\n', 'redis.provider.ts')


def patch_checkpointer(text: str) -> str:
    p='redis-checkpointer.ts'
    text=replace_exact(text,OLD_PUT,NEW_PUT,p)
    text=replace_exact(text,OLD_WRITES,NEW_WRITES,p)
    text=replace_exact(text,OLD_DELETE,NEW_DELETE,p)
    # Existing KEYS command blocks Redis. Always use cursor-based SCAN here.
    text=replace_exact(text,
      '''    return this.required
      ? this.redisProvider.keysRequired(pattern)
      : this.redisProvider.keys(pattern);''',
      '''    return this.required
      ? this.redisProvider.scanRequired(pattern)
      : this.redisProvider.scan(pattern);''',p)
    text=replace_exact(text,
      '      const keys = await this.keys(pattern);',
      "      const keys = (await this.keys(pattern)).sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));",p)
    return text


def patch_package(text: str) -> str:
    data=json.loads(text)
    scripts=data['scripts']
    scripts['audit:agent:recovery']='node scripts/audit-agent-recovery.mjs --strict'
    scripts['smoke:checkpoint:atomic']='node scripts/smoke-redis-atomic-checkpoint.mjs'
    scripts['test:hardening']='node --test scripts/lib/agent-rag-hardening.test.mjs'
    scripts['eval:golden:reviewed']='node scripts/eval-reviewed-golden.mjs'
    scripts['eval:golden:release']='node scripts/eval-reviewed-golden.mjs --release'
    old=scripts['eval:rag:release']
    if 'eval-reviewed-golden.mjs --release' not in old:
        scripts['eval:rag:release']=old + ' && node scripts/eval-reviewed-golden.mjs --release'
    return json.dumps(data,ensure_ascii=False,indent=2)+'\n'


def main():
    if not (ROOT/'apps/rag-api/package.json').is_file():
        raise RuntimeError('Run from the RAG repository root (apps/rag-api/package.json required)')
    edits={
      'apps/rag-api/src/providers/redis/redis.provider.ts':patch_provider,
      'apps/rag-api/src/providers/langgraph-checkpointer/redis-checkpointer.ts':patch_checkpointer,
      'apps/rag-api/package.json':patch_package,
    }
    plan={}
    for name,fn in edits.items():
        target=ROOT/name
        if not target.is_file():raise RuntimeError(f'missing required source file: {name}')
        raw=target.read_text(encoding='utf-8')
        modified=fn(raw)
        if raw!=modified:plan[target]=(raw,modified)
    source_files=[]
    for source in (PACKAGE/'new_files').rglob('*'):
        if not source.is_file() or source.name in ('.DS_Store','Thumbs.db') or source.name.startswith('._'): continue
        rel=source.relative_to(PACKAGE/'new_files')
        target=ROOT/rel
        if target.exists():
            if target.read_bytes()!=source.read_bytes():
                raise RuntimeError(f'existing file differs: {rel}; no changes made')
        else:source_files.append((source,target))
    # All validations are complete. Preserve original modified bytes beside installer.
    for target,(old,new) in plan.items():
        dest=PACKAGE/'backups'/target.relative_to(ROOT)
        dest.parent.mkdir(parents=True,exist_ok=True)
        if not dest.exists():dest.write_text(old,encoding='utf-8')
    for target,(_,new) in plan.items():
        target.write_text(new,encoding='utf-8')
    for source,target in source_files:
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,target)
    print(f'Applied Agent/RAG hardening: {len(plan)} modified, {len(source_files)} new. No DB mutation, commit or push.')
    print('Next: pnpm --filter backend build; pnpm --filter backend exec jest --runInBand redis-checkpointer.atomic.spec.ts')
    print('Next: pnpm --dir apps/rag-api eval:golden:reviewed -- --dataset eval/reviewed-golden.example.json')
    print('Release remains blocked until genuine private human-reviewed holdout + live observations exist.')


if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(f'ERROR: {exc}; installation stopped; check backups if writing had begun',file=sys.stderr)
        sys.exit(1)
