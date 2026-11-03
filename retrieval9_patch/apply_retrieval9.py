#!/usr/bin/env python3
"""Apply a guarded, non-destructive retrieval hardening patch to RAG's main branch.

Usage:
  python3 apply_retrieval9.py /path/to/RAG --check
  python3 apply_retrieval9.py /path/to/RAG

No network is required. Always run pnpm build and tests afterwards.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import shutil
from datetime import datetime, timezone

ROOT = Path('apps/rag-api/src')

class Patcher:
    def __init__(self, root: Path):
        self.root = root
        self.before: dict[str,str] = {}
        self.after: dict[str,str] = {}

    def get(self, rel: str) -> str:
        path = self.root / ROOT / rel
        if not path.is_file():
            raise RuntimeError(f'Expected source file missing: {path}')
        if rel not in self.before:
            self.before[rel] = path.read_text(encoding='utf-8')
            self.after[rel] = self.before[rel]
        return self.after[rel]

    def replace(self, rel: str, old: str, new: str, label: str) -> None:
        content = self.get(rel)
        count = content.count(old)
        if count == 0 and new in content:
            return  # Already applied (idempotent)
        if count != 1:
            raise RuntimeError(f'{label}: expected exactly 1 anchor in {rel}, found {count}. No files changed.')
        self.after[rel] = content.replace(old, new, 1)

    def replace_between(self, rel: str, start: str, end: str, new: str, label: str) -> None:
        s = self.get(rel)
        if s.count(start) == 0 and new in s:
            return  # Already applied
        if s.count(start) != 1 or s.count(end) != 1:
            raise RuntimeError(f'{label}: marker mismatch in {rel}. No files changed.')
        a = s.index(start)
        b = s.index(end, a + len(start))
        self.after[rel] = s[:a] + new + s[b:]

    def insert_before(self, rel: str, anchor: str, text: str, label: str):
        self.replace(rel, anchor, text + anchor, label)

    def commit(self, check: bool):
        changed = {k:v for k,v in self.after.items() if self.before[k] != v}
        print(f'Validated {len(self.after)} files; {len(changed)} require updates.')
        if check:
            print('CHECK-ONLY: nothing written')
            return
        backup_root = self.root.parent / (self.root.name + '-retrieval9-backups') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        for rel, data in changed.items():
            source = self.root / ROOT / rel
            backup = backup_root / ROOT / rel
            backup.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source, backup)
        for rel, data in changed.items():
            source = self.root / ROOT / rel
            temp = source.with_name(source.name + '.retrieval9.tmp')
            temp.write_text(data, encoding='utf-8')
            temp.replace(source)
        print(f'Applied {len(changed)} files. Backups: {backup_root}')

p = None

def main(root: Path, check: bool):
    global p
    p = Patcher(root)

    # 1. PostgreSQL authoritative source lookups replace production cache dependency.
    ac = 'rag/retrieval/authoritative-chunk.service.ts'
    p.replace(ac, "import type { IndexedChunk } from './retrieval-postprocessor';", "import type { IndexedChunk } from './retrieval-postprocessor';\nimport type { Bm25PersistedEntry } from '../indexing/bm25-store';\nimport type { RetrievalScope } from '../evidence/retrieval.types';\nimport { isEffectiveDuring } from './effective-time';\nimport { canonicalizeRole } from '../../modules/chat/role-presets';", 'authority imports')
    p.insert_before(ac, '  private async loadParentContents(\n', '''  /** Description hits are linked to source chunk IDs, never to process-local BM25 state. */
  async loadDescriptionSourceEntries(
    chunkIds: readonly string[],
    scope: AuthoritativeChunkScope,
  ): Promise<Bm25PersistedEntry[]> {
    const ids = [...new Set(chunkIds.filter(Boolean))].slice(0, 1500);
    if (ids.length === 0 || (!scope.userId && !scope.allowedDocIds)) return [];
    const rows = await this.chunks.find({
      where: { id: In(ids), chunkType: 'leaf' },
    });
    return rows.filter((row) => this.isVisible(row, scope)).map((row) => ({
      ...this.toIndexedChunk(row),
      tokens: [],
      userId: row.userId ?? undefined,
      indexGeneration: row.indexGeneration,
      hypotheticalQuestions: this.parseStringArray(row.hypotheticalQuestions),
    }));
  }

  /** Bound, batch-checked evidence visibility for graph and image supplements. */
  async loadVisibleEvidenceDocIds(
    docIds: readonly string[],
    auth: AuthoritativeChunkScope,
    scope?: RetrievalScope,
  ): Promise<Set<string>> {
    const ids = [...new Set(docIds.filter(Boolean))].slice(0, 100);
    if (ids.length === 0 || (!auth.userId && !auth.allowedDocIds)) return new Set();
    const rows = await this.chunks.find({
      where: { docId: In(ids), chunkType: 'leaf' },
      select: {
        docId: true, tenantId: true, userId: true,
        effectiveAt: true, expiredAt: true, lifecycleStatus: true,
        projectId: true, activityId: true, region: true,
        locale: true, channel: true, documentType: true, roleScope: true,
      },
    });
    const visible = new Set<string>();
    for (const row of rows) {
      if (!this.isVisible(row, auth)) continue;
      const lifecycle = {
        lifecycleStatus: row.lifecycleStatus,
        effectiveAt: row.effectiveAt?.toISOString() ?? null,
        expiredAt: row.expiredAt?.toISOString() ?? null,
      };
      if (!isEffectiveDuring(lifecycle, scope?.effectiveTime)) continue;
      if (!(scope?.includeDeprecated ?? Boolean(scope?.effectiveTime)) && row.lifecycleStatus === 'deprecated') continue;
      const fields = ['projectId', 'activityId', 'region', 'locale', 'channel', 'documentType'] as const;
      if (fields.some((field) => scope?.[field] &&
        String(row[field] ?? '').trim().toLowerCase() !== scope[field]?.trim().toLowerCase())) continue;
      if (scope?.role) {
        const roles = this.parseStringArray(row.roleScope).map(canonicalizeRole);
        if (roles.length > 0 && !roles.includes(canonicalizeRole(scope.role))) continue;
      }
      visible.add(row.docId);
    }
    return visible;
  }

''', 'authority retrieval APIs')
    # Fail-closed: no user and no ACL cannot read records at all.
    p.replace(ac, '''    if (scope.allowedDocIds) return scope.allowedDocIds.has(row.docId);
    return !scope.userId || row.userId === scope.userId;''', '''    if (scope.allowedDocIds) return scope.allowedDocIds.has(row.docId);
    return Boolean(scope.userId && row.userId === scope.userId);''', 'authority guest guard')

    cp = 'rag/retrieval/rag-chunk-policy.service.ts'
    p.replace(cp, '''    userId?: string,
    scope?: RetrievalScope,
  ): Awaited<ReturnType<VectorStoreProvider['similaritySearch']>> {
    const entriesById = new Map(
      this.persistedEntries.map((entry) => [entry.id, entry]),
    );''', '''    userId?: string,
    scope?: RetrievalScope,
    authoritativeEntries?: readonly Bm25PersistedEntry[],
  ): Awaited<ReturnType<VectorStoreProvider['similaritySearch']>> {
    const entriesById = new Map(
      (authoritativeEntries ?? this.persistedEntries).map((entry) => [entry.id, entry]),
    );''', 'description source param')

    rs = 'rag/retrieval/retrieval-sources.ts'
    p.replace(rs, '''  ) => VectorHits;
}''', '''  ) => VectorHits | Promise<VectorHits>;
  verifyLegacyVectorHits?: (hits: VectorHits) => Promise<VectorHits>;
}''', 'async description callbacks')
    p.replace(rs, '''      resolveDescriptionHits,
    } = input;''','''      resolveDescriptionHits,
      verifyLegacyVectorHits,
    } = input;''','legacy callback destructure')
    p.replace(rs, '''    let bm25Hits = localBm25Hits;
    const bm25StartedAt''','''    let bm25Hits = localBm25Hits;
    let keywordFailed = false;
    const bm25StartedAt''','keyword status')
    p.replace(rs, '''    } catch (error) {
      this.metricsService.observeRetrievalStage(
        'bm25',
        'error',
        Number(process.hrtime.bigint() - bm25StartedAt) / 1e9,
      );
      if (localBm25Hits.length === 0) throw error;''','''    } catch (error) {
      keywordFailed = true;
      this.metricsService.observeRetrievalStage(
        'bm25',
        'error',
        Number(process.hrtime.bigint() - bm25StartedAt) / 1e9,
      );''', 'independent channel degradation')
    p.replace(rs, '''    if (vectorSearch) {
      let milvusUsed = false;''','''    let vectorFailed = false;
    if (vectorSearch) {
      let milvusUsed = false;''', 'vector status outside block')
    p.replace(rs, '''      let queryVector: number[] | null = null;
      let vectorFailed = false;''','''      let queryVector: number[] | null = null;''', 'remove duplicate vector status')
    p.replace(rs, '''          cosineHits = this.postprocessor.filterActiveVectorHits(
            chunkMeta,
            cosineHits,
            userId,
            allowedDocIds ?? undefined,
            scope,
          );''','''          cosineHits = verifyLegacyVectorHits
            ? await verifyLegacyVectorHits(cosineHits)
            : this.postprocessor.filterActiveVectorHits(
                chunkMeta,
                cosineHits,
                userId,
                allowedDocIds ?? undefined,
                scope,
              );''', 'verified legacy vector source')
    p.replace(rs, '''          const sourceHits = resolveDescriptionHits(
            descriptionHits,''','''          const sourceHits = await resolveDescriptionHits(
            descriptionHits,''','description callback await')
    p.replace(rs, '''    return {
      bm25Hits,
      cosineHits,''','''    if (keywordFailed && (!vectorSearch || vectorFailed) && cosineHits.length === 0 && bm25Hits.length === 0) {
      throw new Error('All available retrieval channels failed; refusing to report a false empty result');
    }
    return {
      bm25Hits,
      cosineHits,''', 'fully failed channels')

    # 2. Don't swallow ES outages. Full scope must be applied before kNN's topK.
    es = 'providers/elasticsearch/elasticsearch.provider.ts'
    p.replace(es, '''      this.logger.warn(`ES search failed: ${(err as Error).message}`);
      return [];''','''      this.logger.warn(`ES search failed: ${(err as Error).message}`);
      throw err;''','keyword failure rethrow')
    p.replace(es, '''      this.logger.warn(`ES knnSearch failed: ${(err as Error).message}`);
      return [];''','''      this.logger.warn(`ES knnSearch failed: ${(err as Error).message}`);
      throw err;''','vector failure rethrow')
    p.replace(es, '''      effectiveTime?: EffectiveTimeRange;
    },''','''      effectiveTime?: EffectiveTimeRange;
      scope?: ElasticsearchSearchScope;
    },''','knn scope type')
    p.replace_between(es, '''      const filter: estypes.QueryDslQueryContainer[] = [];
      if (allowedDocIds != null) {''','''      const queryObj: estypes.QueryDslQueryContainer = {''', '''      const filter = this.chunkFilters(userId, scope, allowedDocIds);
''', 'shared keyword filters')
    p.replace_between(es, '''      const filter: estypes.QueryDslQueryContainer[] = [];
      if (opts?.allowedDocIds != null) {''','''      const k = Math.max(1, Math.floor(topK) || 1);''', '''      const filter = this.chunkFilters(userId, {
        ...(opts?.scope ?? {}),
        includeDeprecated: opts?.includeDeprecated ?? opts?.scope?.includeDeprecated,
        effectiveTime: opts?.effectiveTime ?? opts?.scope?.effectiveTime,
      }, opts?.allowedDocIds);
''', 'shared knn filters')
    p.insert_before(es, '''  /**
   * rag_chunks 的 dense_vector 向量字段定义''', '''  /** Same ACL, lifecycle and business filters for lexical and kNN TopK. */
  private chunkFilters(
    userId?: string,
    scope: ElasticsearchSearchScope = {},
    allowedDocIds?: ReadonlySet<string>,
  ): estypes.QueryDslQueryContainer[] {
    const filters: estypes.QueryDslQueryContainer[] = [];
    if (allowedDocIds) filters.push({ terms: { docId: [...allowedDocIds] } });
    else if (userId) filters.push({ term: { userId } });
    for (const [field, value] of Object.entries({
      projectId: scope.projectId,
      activityId: scope.activityId,
      region: scope.region,
      locale: scope.locale,
      channel: scope.channel,
      documentType: scope.documentType,
    })) {
      if (value) filters.push({ term: { [field]: value } });
    }
    if (scope.role) {
      // A document without roleScope is visible to all authorized roles.
      filters.push({ bool: {
        should: [
          { term: { roleScope: scope.role } },
          { bool: { must_not: [{ exists: { field: 'roleScope' } }] } },
        ],
        minimum_should_match: 1,
      } });
    }
    if (scope.effectiveTime) filters.push(...effectiveTimeFilters(scope.effectiveTime));
    const excludeDeprecated = scope.effectiveTime
      ? scope.includeDeprecated === false
      : !scope.includeDeprecated;
    if (excludeDeprecated) filters.push({ bool: {
      must_not: [{ term: { lifecycleStatus: 'deprecated' } }],
    } });
    filters.push({ bool: { must_not: [
      { term: { lifecycleStatus: 'draft' } },
      { term: { lifecycleStatus: 'archived' } },
    ] } });
    // Additional chunk-level fields are supported only where indexed in rag_chunks.
    return filters;
  }

''', 'shared filter method')

    # 3. Let each planned query return authorized candidates, never pre-trimmed context.
    opts = 'rag/contracts/rag-types.ts'
    p.replace(opts, '''  skipRerank?: boolean;
''','''  skipRerank?: boolean;
  /** Internal only: preserve candidates for global query fusion before context cropping. */
  candidateOnly?: boolean;
''','internal candidate type')
    rr = 'rag/retrieval/rag-retrieval.service.ts'
    p.replace(rr, '''            skipRerank: true,
            rankingQuery: originalQuery,''','''            skipRerank: true,
            candidateOnly: true,
            rankingQuery: originalQuery,''','candidate mode for plan')
    p.replace(rs, '''        includeDeprecated: scope?.includeDeprecated,
        ...(scope?.effectiveTime ? { effectiveTime: scope.effectiveTime } : {}),
        allowedDocIds,''','''        includeDeprecated: scope?.includeDeprecated,
        ...(scope?.effectiveTime ? { effectiveTime: scope.effectiveTime } : {}),
        scope,
        allowedDocIds,''','knn complete scope forwarding')
    # Need exact equivalent of the previous insertion in esKnnVectorHits, see source below.

    # Start embedding alongside keyword search; turn rejection into a resolved result
    # so it cannot become an unhandled promise rejection while BM25 is in flight.
    p.replace(rs, '''    let bm25Hits = localBm25Hits;''', '''    const queryVectorAttempt = vectorSearch
      ? this.embeddingProvider.embedQuery(normalizedQuery).then(
          (vector) => ({ vector, error: null as unknown }),
          (error: unknown) => ({ vector: null as number[] | null, error }),
        )
      : null;
    let bm25Hits = localBm25Hits;''', 'parallel embedding start')
    p.replace(rs, '''      try {
        queryVector = await this.embeddingProvider.embedQuery(normalizedQuery);
        if (esKnnReady) {''', '''      try {
        const embedded = await queryVectorAttempt;
        if (!embedded) throw new Error('embedding not scheduled');
        if (embedded.error) throw embedded.error;
        queryVector = embedded.vector;
        if (esKnnReady) {''', 'parallel embedding completion')

    # 4. Bind description retrieval and migration-only Milvus reads to PostgreSQL.
    p.replace(rr, '''      resolveDescriptionHits: (hits, query, ids, owner, scope) =>
        this.chunkPolicy.mapDescriptionHitsToSourceChunks(
          hits,
          query,
          ids,
          owner,
          scope,
        ),''', '''      resolveDescriptionHits: async (hits, query, ids, owner, scope) => {
        const entries = this.authoritativeChunks
          ? await this.authoritativeChunks.loadDescriptionSourceEntries(
              hits.flatMap((hit) => hit.sourceChunkIds),
              {
                userId: owner,
                tenantId: options.tenantId,
                allowedDocIds: ids ?? undefined,
              },
            )
          : undefined;
        return this.chunkPolicy.mapDescriptionHitsToSourceChunks(
          hits, query, ids, owner, scope, entries,
        );
      },
      verifyLegacyVectorHits: this.authoritativeChunks
        ? async (hits) => {
            const raw = hits.map((hit) => ({
              ...hit, bm25Score: 0, cosineScore: hit.score, totalScore: hit.score,
            }));
            const trusted = await this.authoritativeChunks!.hydrateCandidates(raw, {
              userId,
              tenantId: options.tenantId,
              allowedDocIds: allowedDocIds ?? undefined,
            });
            return trusted
              .filter((chunk) =>
                this.chunkPolicy.isLifecycleVisible(chunk, options.scope) &&
                this.chunkPolicy.matchesScope(chunk, options.scope),
              )
              .map((chunk) => ({
                id: chunk.id, docId: chunk.docId, chunkIndex: chunk.chunkIndex,
                content: chunk.content, score: chunk.cosineScore,
              }));
          }
        : undefined,''', 'PostgreSQL source rehydration')

    # 5. Graph and image evidence use a batched authoritative scope check.
    p.replace(rr, '''    const isDocumentVisible = (docId: string) =>
      this.chunkPolicy.isEvidenceDocumentVisible(
        docId,
        userId,
        allowedDocIds ?? undefined,
        options.scope,
      );''', '''    // Cheap ACL pre-check before provider probes; authoritative scope checks
    // are performed after their small candidate sets return.
    const isDocumentVisible = (docId: string) =>
      Boolean(userId && allowedDocIds?.has(docId));''', 'supplemental precheck')
    p.replace(rr, '''    const shouldMergeGraph = graphRequested;
    const shouldMergeImages = imageProbe.hits.length > 0;
    const authoritativeContext =''', '''    const shouldMergeGraph = graphRequested;
    const shouldMergeImages = imageProbe.hits.length > 0;
    const supplementaryDocIds = [...new Set(
      [...graphChunks, ...imageChunks].map((chunk) => chunk.docId),
    )];
    const visibleEvidenceDocIds = this.authoritativeChunks
      ? await this.authoritativeChunks.loadVisibleEvidenceDocIds(
          supplementaryDocIds,
          {
            userId,
            tenantId: options.tenantId,
            allowedDocIds: allowedDocIds ?? undefined,
          },
          options.scope,
        )
      : new Set(supplementaryDocIds.filter((docId) =>
          this.chunkPolicy.isEvidenceDocumentVisible(
            docId, userId, allowedDocIds ?? undefined, options.scope,
          ),
        ));
    const authoritativeContext =''', 'batched visibility lookup')
    p.replace(rr, '''    const visibleGraphChunks = graphChunks.filter((chunk) =>
      this.chunkPolicy.isEvidenceDocumentVisible(
        chunk.docId,
        userId,
        allowedDocIds ?? undefined,
        options.scope,
      ),
    );
    const visibleImageChunks = imageChunks.filter((chunk) =>
      this.chunkPolicy.isEvidenceDocumentVisible(
        chunk.docId,
        userId,
        allowedDocIds ?? undefined,
        options.scope,
      ),
    );''', '''    const visibleGraphChunks = graphChunks.filter((chunk) =>
      visibleEvidenceDocIds.has(chunk.docId),
    );
    const visibleImageChunks = imageChunks.filter((chunk) =>
      visibleEvidenceDocIds.has(chunk.docId),
    );''', 'replace local evidence checks')

    # 6. Candidate lists remain uncropped until the single final plan fusion.
    p.replace(rr, '''    const ranked = rerankOutcome.chunks
      .slice(0, profile.candidateDepth)''', '''    const ranked = rerankOutcome.chunks
      .slice(0, options.candidateOnly ? candidateDepth : profile.candidateDepth)''', 'candidate-only depth')
    p.replace(rr, '''    const authoritativeContext = this.authoritativeChunks
      ? await this.authoritativeChunks.loadContextChunks(''', '''    const authoritativeContext = !options.candidateOnly && this.authoritativeChunks
      ? await this.authoritativeChunks.loadContextChunks(''', 'skip context fetch in candidate-only mode')
    p.replace(rr, '''    const expanded = authoritativeContext
      ? this.chunkPolicy.expandContextChunksFrom(''', '''    const expanded = options.candidateOnly
      ? ranked
      : authoritativeContext
      ? this.chunkPolicy.expandContextChunksFrom(''', 'avoid premature neighbor expansion')
    p.replace(rr, '''    const built = this.contextBuilder.build(
      [
        ...(shouldMergeGraph ? visibleGraphChunks : []),
        ...(shouldMergeImages ? visibleImageChunks : []),
        ...expanded,
        ...(options.supplementalEvidence ?? []),
      ],
      profile,
      normalizedQuery,
    );''', '''    const stagedChunks = options.candidateOnly
      ? [
          ...expanded,
          ...(shouldMergeGraph ? visibleGraphChunks : []),
          ...(shouldMergeImages ? visibleImageChunks : []),
        ]
      : [
          ...(shouldMergeGraph ? visibleGraphChunks : []),
          ...(shouldMergeImages ? visibleImageChunks : []),
          ...expanded,
          ...(options.supplementalEvidence ?? []),
        ];
    const built = options.candidateOnly
      ? {
          chunks: stagedChunks,
          context: '',
          stats: {
            inputChunks: stagedChunks.length,
            duplicateChunksRemoved: 0,
            documentLimitRemoved: 0,
            budgetRemoved: 0,
            contextCharacters: 0,
          },
        }
      : this.contextBuilder.build(stagedChunks, profile, normalizedQuery);''', 'no early context clipping')
    p.replace(rr, '''    const built = this.contextBuilder.build(
      rerankOutcome.chunks,
      profile,
      originalQuery,
    );''', '''    const globalAllowedDocIds = userId
      ? await this.documentPermissionService.getAllowedDocIds(
          userId,
          options.roles ?? [],
          options.departmentIds ?? [],
          options.tenantId,
          options.trustedAdminPrincipal,
        )
      : null;
    const authorizedContext = this.authoritativeChunks
      ? await this.authoritativeChunks.loadContextChunks(
          rerankOutcome.chunks.map((chunk) => chunk.docId),
          {
            userId,
            tenantId: options.tenantId,
            allowedDocIds: globalAllowedDocIds ?? undefined,
          },
        )
      : undefined;
    const finalCandidates = authorizedContext
      ? this.chunkPolicy.expandContextChunksFrom(
          authorizedContext,
          rerankOutcome.chunks,
          profile,
          userId,
          executionPlan.scope ?? options.scope,
          globalAllowedDocIds ?? undefined,
        )
      : rerankOutcome.chunks;
    const built = this.contextBuilder.build(
      finalCandidates,
      profile,
      originalQuery,
    );''', 'global expansion after rerank')

    # 7. Different files in the same ZIP docId may never be neighboring symbols.
    post = 'rag/retrieval/retrieval-postprocessor.ts'
    p.replace(post, '''      const sameDocument = entries.filter((entry) => entry.docId === hit.docId);''','''      const sameDocument = entries.filter((entry) =>
        entry.docId === hit.docId && this.sameSourceFile(entry, hit),
      );''', 'code file boundary')
    p.insert_before(post, '''  private toExpandedChunk(
''', '''  /** A ZIP repository shares one docId; code expansion must stay in one file. */
  private sameSourceFile(entry: IndexedChunk, hit: RetrievedChunk): boolean {
    if (entry.documentType !== 'code' && hit.documentType !== 'code') return true;
    const filePath = (raw?: string | null): string | null => {
      if (!raw) return null;
      try {
        const data: unknown = JSON.parse(raw);
        if (!data || typeof data !== 'object' || !('filePath' in data)) return null;
        const path = (data as { filePath: unknown }).filePath;
        return typeof path === 'string' && path.length > 0 ? path : null;
      } catch { return null; }
    };
    const entryPath = filePath(entry.sourceMetadata);
    return Boolean(entryPath && entryPath === filePath(hit.sourceMetadata));
  }

''','code file boundary helper')

    # 8. Do not run ContextBuilder twice when there is no new evidence to add.
    answer = 'rag/answer/rag-answer.service.ts'
    p.replace(answer, '''    const evidenceBuild = this.contextBuilder.build(
      [...chunks, ...evidenceObsidianChunks],
      retrieval.profile,
      normalizedQuery,
    );
    const evidenceChunks = this.evidenceService.expandRuleCompanions(
      evidenceBuild.chunks,
      retrieveOptions.scope,
    );''','''    const combinedEvidence = evidenceObsidianChunks.length > 0
      ? this.contextBuilder.build(
          [...chunks, ...evidenceObsidianChunks],
          retrieval.profile,
          normalizedQuery,
        ).chunks
      : chunks;
    const evidenceChunks = this.evidenceService.expandRuleCompanions(
      combinedEvidence,
      retrieveOptions.scope,
    );''','skip duplicate context building')

    # 9. Source code citations and diversification by file instead of entire ZIP.
    ctx = 'rag/retrieval/context-builder.ts'
    p.replace(ctx, '''    const value = JSON.parse(raw) as Record<string, unknown>;
    const filename =''','''    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.filePath === 'string' && value.filePath.trim()) {
      const path = value.filePath.slice(0, 180);
      const symbol = typeof value.symbol === 'string' ? value.symbol.slice(0, 120) : '';
      const first = Number.isSafeInteger(value.startLine) ? Number(value.startLine) : null;
      const last = Number.isSafeInteger(value.endLine) ? Number(value.endLine) : null;
      const lines = first && last && last >= first ? `L${first}-L${last}` : '';
      return [path, symbol, lines].filter(Boolean).join(' / ');
    }
    const filename =''','code citations')
    p.replace(ctx, '''    for (const chunk of unique) {
      const count = perDocument.get(chunk.docId) ?? 0;
      if (count >= profile.maxChunksPerDocument) {
        documentLimitRemoved += 1;
        continue;
      }
      perDocument.set(chunk.docId, count + 1);
      diversified.push(chunk);
    }''', '''    for (const chunk of unique) {
      // Repository ZIP uploads share docId; diversify code per file, not per archive.
      let groupId = chunk.docId;
      if (chunk.documentType === 'code' && chunk.sourceMetadata) {
        try {
          const meta: unknown = JSON.parse(chunk.sourceMetadata);
          if (meta && typeof meta === 'object' && 'filePath' in meta &&
              typeof (meta as { filePath: unknown }).filePath === 'string') {
            groupId += `::${(meta as { filePath: string }).filePath}`;
          }
        } catch { /* malformed metadata never causes a crash */ }
      }
      const count = perDocument.get(groupId) ?? 0;
      if (count >= profile.maxChunksPerDocument) {
        documentLimitRemoved += 1;
        continue;
      }
      perDocument.set(groupId, count + 1);
      diversified.push(chunk);
    }''','code per-file diversification')

    # 10. Preserve optional search scope fields when sharing query filters.
    p.replace(es, '''    if (scope.effectiveTime) filters.push(...effectiveTimeFilters(scope.effectiveTime));''','''    if (scope.fileType) {
      filters.push({ wildcard: { 'filename.keyword': `*.${scope.fileType}` } });
    }
    if (scope.updatedRange) {
      const gte = {
        day: 'now-1d/d', week: 'now-7d/d', month: 'now-30d/d',
      }[scope.updatedRange];
      if (gte) filters.push({ range: { updatedAt: { gte } } });
    }
    if (scope.effectiveTime) filters.push(...effectiveTimeFilters(scope.effectiveTime));''','preserve existing scope contract')

    # 11. Code-aware lexical retrieval via dedicated ES keyword fields.
    p.insert_before(es, '''const ES_CHUNK_BULK_BATCH_SIZE = 100;''', '''const CODE_INDEX_PROPERTIES = {
  codeFilePath: { type: 'keyword', ignore_above: 2048 },
  codeSymbol: { type: 'keyword', ignore_above: 512 },
  codeFullSymbol: { type: 'keyword', ignore_above: 768 },
  codeLanguage: { type: 'keyword', ignore_above: 64 },
} satisfies Record<string, estypes.MappingProperty>;

function codeIndexFields(sourceMetadata?: string | null): Record<string, string> {
  if (!sourceMetadata) return {};
  try {
    const raw: unknown = JSON.parse(sourceMetadata);
    if (!raw || typeof raw !== 'object' || !('kind' in raw) ||
        (raw as { kind: unknown }).kind !== 'code') return {};
    const item = raw as Record<string, unknown>;
    const field = (key: string) => typeof item[key] === 'string' ? item[key] as string : '';
    const symbol = field('symbol');
    const parent = field('parentSymbol');
    return {
      codeFilePath: field('filePath'),
      codeSymbol: symbol,
      codeFullSymbol: parent && symbol ? `${parent}.${symbol}` : symbol,
      codeLanguage: field('language'),
    };
  } catch { return {}; }
}

''','code index metadata helper')
    p.replace(es, '''          const patch: Record<string, estypes.MappingProperty> = {};
''', '''          const patch: Record<string, estypes.MappingProperty> = {};
          for (const [key, value] of Object.entries(CODE_INDEX_PROPERTIES)) {
            if (!properties?.[key]) patch[key] = value;
          }
''', 'code index existing mapping')
    p.replace(es, '''          ...BUSINESS_PROPERTIES,
          // dense_vector''', '''          ...BUSINESS_PROPERTIES,
          ...CODE_INDEX_PROPERTIES,
          // dense_vector''', 'new index code mapping')
    p.replace(es, '''              sourceMetadata: c.sourceMetadata,
              docVersion: c.docVersion,''', '''              sourceMetadata: c.sourceMetadata,
              ...codeIndexFields(c.sourceMetadata),
              docVersion: c.docVersion,''', 'index code metadata')
    p.replace(es, '''      const queryObj: estypes.QueryDslQueryContainer = {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['content^1', 'hypotheticalQuestions^2'],
                type: 'best_fields',
              },
            },
          ],
          ...(filter.length > 0 ? { filter } : {}),
        },
      };''', '''      const codeIdentifiers = [...new Set(
        (query.match(/[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*/g) ?? [])
          .filter((term) => term.length >= 3),
      )].slice(0, 8);
      const queryObj: estypes.QueryDslQueryContainer = {
        bool: {
          must: [{ multi_match: {
            query,
            fields: ['content^1', 'hypotheticalQuestions^2'],
            type: 'best_fields',
          } }],
          ...(codeIdentifiers.length > 0 ? { should: codeIdentifiers.flatMap((term) => [
            { term: { codeSymbol: { value: term, boost: 5 } } },
            { term: { codeFullSymbol: { value: term, boost: 8 } } },
            { term: { codeFilePath: { value: term, boost: 6 } } },
          ]) } : {}),
          ...(filter.length > 0 ? { filter } : {}),
        },
      };''', 'code symbol ranking')

    # 12. Make provider failure versus no-result visible in diagnostics.
    p.replace(rs, '''    const bm25Source = this.elasticsearchProvider.isEnabled()
      ? 'elasticsearch'
      : 'bm25';''', '''    const bm25Source = this.elasticsearchProvider.isEnabled() && !keywordFailed
      ? 'elasticsearch'
      : 'bm25';''', 'accurate BM25 fallback label')
    p.replace(rs, '''        : queryVector && esKnnReady
          ? 'elasticsearch'
          : descriptionUsed
            ? 'milvus'
            : 'none';''', '''        : queryVector && esKnnReady && !vectorFailed
          ? 'elasticsearch'
          : descriptionSourceChunkCount > 0
            ? 'milvus'
            : 'none';''', 'accurate vector source label')
    p.replace(rs, '''      descriptionUsed,
    };
''', '''      descriptionUsed,
      keywordFailed,
      vectorFailed,
    };
''', 'retrieval status returned')
    diag = 'rag/evidence/retrieval.types.ts'
    p.replace(diag, '''  /** 本轮是否因高置信追问执行了补全问题检索。 */''', '''  /** Search channel failures; independent of legitimate empty results. */
  degradedChannels?: Array<'keyword' | 'vector'>;
  /** 本轮是否因高置信追问执行了补全问题检索。 */''', 'degradation diagnostic type')
    p.replace(rr, '''      descriptionSourceChunkCount,
    } = await this.retrievalSources.recall({''', '''      descriptionSourceChunkCount,
      keywordFailed,
      vectorFailed,
    } = await this.retrievalSources.recall({''', 'consume degradation state')
    p.replace(rr, '''      candidateDepth: profile.candidateDepth,
      expandedChunks: expanded.filter(''', '''      candidateDepth: profile.candidateDepth,
      degradedChannels: [
        ...(keywordFailed ? ['keyword' as const] : []),
        ...(vectorFailed ? ['vector' as const] : []),
      ],
      expandedChunks: expanded.filter(''', 'diagnostic degradation state')
    p.replace(rr, '''      contextualQueryUsed: queries.length > 1,
''','''      contextualQueryUsed: queries.length > 1,
      degradedChannels: [...new Set(queryRuns.flatMap((run) =>
        run.status === 'fulfilled' ? (run.value.diagnostics.degradedChannels ?? []) : [],
      ))],
''','plan aggregation of degradation state')

    # 13. Fix old test cases expecting Milvus-first retrieval semantics.
    st = 'rag/retrieval/retrieval-sources.spec.ts'
    p.replace(st, '''    f.embedding.embedQuery.mockRejectedValue(new Error('embedding timeout'));
    const result =''', '''    f.embedding.embedQuery.mockRejectedValue(new Error('embedding timeout'));
    f.es.search.mockResolvedValue(f.request.localBm25Hits);
    const result =''', 'test keyword available when embedding fails')
    p.replace(st, '''  it('uses ES when the primary vector channel is unavailable and still checks authorized source metadata', async () => {''', '''  it('uses ES as primary vector channel with ACL filters applied at the provider', async () => {''', 'test ES primary title')
    p.replace(st, '''    f.es.knnSearch.mockResolvedValue([
      { id: 'a', score: 0.9 },
      { id: 'unknown', score: 1 },
    ]);''', '''    f.es.knnSearch.mockResolvedValue([
      { id: 'a', docId: 'doc-a', chunkIndex: 0, content: 'source', score: 0.9 },
    ]);''', 'test valid ES vector source')
    p.replace(st, '''      includeDeprecated: undefined,
      allowedDocIds: f.request.allowedDocIds,
''', '''      includeDeprecated: undefined,
      scope: undefined,
      allowedDocIds: f.request.allowedDocIds,
''', 'test scope forwarding to kNN')
    p.replace(st, '''    expect(result.cosineHits[0]).toMatchObject({
      id: 'a',
      content: 'source',
      score: 0.8,
    });
    expect(result.descriptionUsed).toBe(false);
    expect(result.vectorSource).toBe('milvus');''', '''    expect(result.cosineHits[0]).toMatchObject({
      id: 'a',
      score: 0.9,
    });
    expect(result.descriptionUsed).toBe(false);
    expect(result.vectorSource).toBe('elasticsearch');''', 'test description fallback')
    p.replace(st, '''  it('preserves keyword errors instead of silently changing the existing failure contract', async () => {
    const f = fixture();
    f.es.search.mockRejectedValue(new Error('keyword failure'));
    await expect(f.service.recall(f.request)).rejects.toThrow(
      'keyword failure',
    );
    expect(f.embedding.embedQuery).not.toHaveBeenCalled();''', '''  it('keeps independent vector and local BM25 on an ES keyword outage', async () => {
    const f = fixture();
    f.es.search.mockRejectedValue(new Error('keyword failure'));
    const result = await f.service.recall(f.request);
    expect(result.bm25Hits).toEqual(f.request.localBm25Hits);
    expect(result.keywordFailed).toBe(true);
    expect(f.embedding.embedQuery).toHaveBeenCalled();''', 'test independent channel failures')

    # 14. Cross-encoder instruction matches enterprise documents and source code,
    # not generic public web search results.
    rer = 'tools/dashscope-rerank.service.ts'
    p.replace(rer, '''          'Given a web search query, retrieve relevant passages that answer the query.',''', '''          'Rank enterprise knowledge-base evidence by relevance to the user question. Prefer exact identifiers and source symbols for code questions, and respect dates, exceptions and applicability for policy questions.', ''', 'enterprise rerank instruction')

    # Add a focused regression suite, but never overwrite a divergent local test.
    test_source = Path(__file__).with_name('retrieval9-hardening.spec.ts')
    if not test_source.is_file():
        raise RuntimeError(f'Missing bundled test suite: {test_source}')
    test_destination = root / ROOT / 'rag/retrieval/retrieval9-hardening.spec.ts'
    if test_destination.exists() and test_destination.read_bytes() != test_source.read_bytes():
        raise RuntimeError(f'Test file already exists with different contents: {test_destination}')
    p.commit(check)
    if not check and not test_destination.exists():
        test_destination.write_bytes(test_source.read_bytes())
        print(f'Installed test: {test_destination}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--check', action='store_true')
    a = parser.parse_args()
    main(a.repo.resolve(), a.check)
