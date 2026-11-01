/**
 * Read-only retrieval client plus explicit test-data ingestion for an isolated LightRAG server.
 * Intentionally NOT wired into the production RAG query or document indexing paths.
 * API: https://github.com/HKUDS/LightRAG/blob/main/docs/LightRAG-API-Server.md
 */
export class LightRagPocClient {
  constructor({ baseUrl, apiKey, timeoutMs = 30_000, fetchImpl = fetch }) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      throw new Error('LIGHTRAG_POC_URL is required');
    }
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('LIGHTRAG_POC_URL must be an HTTP(S) URL without credentials, query or fragment');
    }
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('LIGHTRAG_POC_API_KEY is required; unauthenticated POC access is disabled');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
      throw new Error('timeoutMs must be between 1000 and 300000 milliseconds');
    }
    this.baseUrl = url.href.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async request(method, path, data) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      // Do not echo potentially sensitive server responses or credentials into CI logs.
      throw new Error(`LightRAG ${method} ${path} failed with HTTP ${response.status}`);
    }
    const value = await response.json();
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`LightRAG ${path} returned an invalid JSON object`);
    }
    return value;
  }

  async health() {
    return this.request('GET', '/health');
  }

  /** Explicitly for synthetic, isolated POC documents. This enqueues asynchronous indexing. */
  async insertText({ text, fileSource }) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('text is required');
    if (typeof fileSource !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(fileSource)) {
      throw new Error('fileSource must be a safe basename');
    }
    return this.request('POST', '/documents/text', { text, file_source: fileSource });
  }

  /** Returns retrieved context, NOT an LLM answer. Never use this without production ACL protection. */
  async queryContext({ query, mode = 'mix', topK = 10 }) {
    const supported = new Set(['naive', 'local', 'global', 'hybrid', 'mix']);
    if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
    if (!supported.has(mode)) throw new Error(`unsupported retrieval mode: ${mode}`);
    if (!Number.isInteger(topK) || topK < 1 || topK > 1000) throw new Error('topK must be 1..1000');
    const result = await this.request('POST', '/query', {
      query,
      mode,
      top_k: topK,
      only_need_context: true,
      include_references: true,
      include_chunk_content: true,
      stream: false,
    });
    if (typeof result.response !== 'string' || result.llm_generated === true) {
      throw new Error('LightRAG did not return retrieval-only context');
    }
    return {
      context: result.response,
      references: Array.isArray(result.references) ? result.references : [],
      responseTimeSeconds: typeof result.response_time === 'number' ? result.response_time : null,
    };
  }
}
