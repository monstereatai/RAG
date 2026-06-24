import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export const configuration = () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // 认证（JWT）
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  // API 限流（默认 60 req/min）
  throttle: {
    ttlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '60', 10),
  },

  // 向量库（可插拔：milvus | pgvector）
  vectorStore: {
    provider: process.env.VECTOR_STORE_PROVIDER ?? 'milvus',
    milvus: {
      host: process.env.MILVUS_HOST ?? '127.0.0.1',
      port: parseInt(process.env.MILVUS_PORT ?? '19530', 10),
      collection: process.env.MILVUS_COLLECTION ?? 'rag_chunks',
      dimension: parseInt(process.env.MILVUS_DIMENSION ?? '1024', 10),
      indexType: process.env.MILVUS_INDEX_TYPE ?? 'HNSW',
      hnswM: parseInt(process.env.MILVUS_HNSW_M ?? '16', 10),
      hnswEfConstruction: parseInt(
        process.env.MILVUS_HNSW_EF_CONSTRUCTION ?? '200',
        10,
      ),
      hnswEfSearch: parseInt(process.env.MILVUS_HNSW_EF_SEARCH ?? '64', 10),
      searchTimeoutMs: parseInt(
        process.env.MILVUS_SEARCH_TIMEOUT_MS ?? '800',
        10,
      ),
      deleteTimeoutMs: parseInt(
        process.env.MILVUS_DELETE_TIMEOUT_MS ?? '1000',
        10,
      ),
      warmupTimeoutMs: parseInt(
        process.env.MILVUS_WARMUP_TIMEOUT_MS ?? '1500',
        10,
      ),
      circuitOpenMs: parseInt(
        process.env.MILVUS_CIRCUIT_OPEN_MS ?? '30000',
        10,
      ),
    },
    pgvector: {
      url:
        process.env.PGVECTOR_URL ??
        'postgresql://postgres:postgres@localhost:5432/rag',
      tableName: process.env.PGVECTOR_TABLE ?? 'rag_chunks',
    },
  },

  // 关系型数据库（可插拔：postgres | mysql）
  relationalDb: {
    provider: process.env.RELATIONAL_DB_PROVIDER ?? 'postgres',
    postgres: {
      url:
        process.env.POSTGRES_URL ??
        'postgresql://postgres:postgres@localhost:5432/rag',
    },
    mysql: {
      url: process.env.MYSQL_URL ?? 'mysql://root:root@localhost:3306/rag',
    },
  },

  // Redis（对话历史 + 缓存）
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  // Elasticsearch（全文检索）
  elasticsearch: {
    node: process.env.ES_NODE ?? 'http://localhost:9200',
    apiKey: process.env.ES_API_KEY ?? '',
  },

  // LLM（通义千问 + OpenAI 兼容）
  llm: {
    provider: process.env.LLM_PROVIDER ?? 'qwen',
    qwen: {
      apiKey: process.env.QWEN_API_KEY ?? '',
      baseUrl:
        process.env.QWEN_BASE_URL ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL ?? 'qwen-plus',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    },
  },

  // Embedding
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER ?? 'qwen',
    qwen: {
      apiKey: process.env.QWEN_API_KEY ?? '',
      baseUrl:
        process.env.QWEN_BASE_URL ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-v3',
      dimension: parseInt(process.env.EMBEDDING_DIMENSION ?? '1024', 10),
    },
  },

  // 语音（腾讯云 ASR/TTS）
  speech: {
    provider: process.env.SPEECH_PROVIDER ?? 'tencent',
    tencent: {
      secretId: process.env.TENCENT_SECRET_ID ?? '',
      secretKey: process.env.TENCENT_SECRET_KEY ?? '',
      region: process.env.TENCENT_REGION ?? 'ap-shanghai',
    },
  },

  // 搜索工具（Bocha）
  bocha: {
    apiKey: process.env.BOCHA_API_KEY ?? '',
  },

  // Rerank（DashScope）
  rerank: {
    provider: process.env.RERANK_PROVIDER ?? 'dashscope',
    apiKey: process.env.RERANK_API_KEY ?? '',
    model: process.env.RERANK_MODEL ?? 'qwen3-rerank',
    baseUrl:
      process.env.RERANK_BASE_URL ??
      'https://dashscope-intl.aliyuncs.com/compatible-api/v1/reranks',
  },

  // RAG 质量闸门
  ragQuality: {
    minTopScore: parseFloat(process.env.RAG_MIN_TOP_SCORE ?? '0.05'),
    minQueryTokenOverlap: parseInt(
      process.env.RAG_MIN_QUERY_TOKEN_OVERLAP ?? '1',
      10,
    ),
    minCitationCoverage: parseFloat(
      process.env.RAG_MIN_CITATION_COVERAGE ?? '0.15',
    ),
    sourceAuthorityRules: process.env.RAG_SOURCE_AUTHORITY_RULES ?? '',
  },

  // Agentic RAG 成本与复杂度边界
  agentic: {
    confidenceThreshold: parseFloat(
      process.env.AGENTIC_CONFIDENCE_THRESHOLD ?? '0.7',
    ),
    maxRetries: parseInt(process.env.AGENTIC_MAX_RETRIES ?? '2', 10),
    maxAugmentedQueries: parseInt(
      process.env.AGENTIC_MAX_AUGMENTED_QUERIES ?? '3',
      10,
    ),
    maxRetrievalQueries: parseInt(
      process.env.AGENTIC_MAX_RETRIEVAL_QUERIES ?? '4',
      10,
    ),
    maxRetrievedChunks: parseInt(
      process.env.AGENTIC_MAX_RETRIEVED_CHUNKS ?? '5',
      10,
    ),
    maxWebSearchResults: parseInt(
      process.env.AGENTIC_MAX_WEB_SEARCH_RESULTS ?? '5',
      10,
    ),
    maxRerankTopN: parseInt(process.env.AGENTIC_MAX_RERANK_TOP_N ?? '5', 10),
    maxAutoQueryLength: parseInt(
      process.env.AGENTIC_MAX_AUTO_QUERY_LENGTH ?? '500',
      10,
    ),
    webSearchFallbackEnabled:
      process.env.AGENTIC_WEB_SEARCH_FALLBACK_ENABLED !== 'false',
    rerankEnabled: process.env.AGENTIC_RERANK_ENABLED !== 'false',
  },

  // LangSmith 评测与追踪（可选）
  langsmith: {
    tracing: process.env.LANGSMITH_TRACING === 'true',
    apiKey: process.env.LANGSMITH_API_KEY ?? '',
    project: process.env.LANGSMITH_PROJECT ?? 'rag-evaluation',
    endpoint:
      process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com',
    dataset: process.env.LANGSMITH_DATASET ?? 'rag-smoke',
  },

  // 知识图谱（Neo4j，可选）
  neo4j: {
    enabled: process.env.GRAPH_RAG_ENABLED === 'true',
    url: process.env.NEO4J_URL ?? 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME ?? 'neo4j',
    password: process.env.NEO4J_PASSWORD ?? '',
  },

  // Mem0 长期记忆（可插拔：cloud | local | 禁用）
  mem0: {
    enabled: process.env.MEM0_ENABLED === 'true',
    provider: process.env.MEM0_PROVIDER ?? 'cloud',
    apiKey: process.env.MEM0_API_KEY ?? '',
    baseUrl: process.env.MEM0_BASE_URL ?? '',
  },

  // MCP 工具协议（默认关闭，避免示例 server 影响本地启动）
  mcp: {
    enabled: process.env.MCP_ENABLED === 'true',
    configPath:
      process.env.MCP_CONFIG_PATH ||
      path.resolve(process.cwd(), '../workspace/mcp-servers.yaml'),
  },

  // 工作区
  workspace: {
    uploadDir:
      process.env.UPLOAD_DIR ??
      path.resolve(process.cwd(), '../workspace/uploads'),
  },

  // Skills 技能系统
  skills: {
    rootDir: process.env.SKILLS_DIR ?? path.resolve(process.cwd(), '../skills'),
  },
});
