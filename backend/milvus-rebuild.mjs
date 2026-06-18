import { MilvusClient, DataType, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({
  address: '127.0.0.1:19530',
  timeout: 60000,
});

const COLLECTION_NAME = 'rag_chunks';
const VECTOR_DIM = 1024;

async function main() {
  await client.connectPromise;
  console.log('Connected');

  // 1. 删除 collection
  console.log('\nDropping collection...');
  try {
    await client.dropCollection({ collection_name: COLLECTION_NAME });
    console.log('Collection dropped');
  } catch (err) {
    console.log('Drop failed:', err.message);
  }

  // 2. 重新创建 collection（参考 agent-course/milvus-test/src/insert.mjs）
  console.log('\nCreating collection...');
  await client.createCollection({
    collection_name: COLLECTION_NAME,
    fields: [
      { name: 'id', data_type: DataType.VarChar, max_length: 64, is_primary_key: true },
      { name: 'vector', data_type: DataType.FloatVector, dim: VECTOR_DIM },
      { name: 'content', data_type: DataType.VarChar, max_length: 8192 },
      { name: 'doc_id', data_type: DataType.VarChar, max_length: 64 },
      { name: 'chunk_index', data_type: DataType.Int64 },
    ],
  });
  console.log('Collection created');

  // 3. 创建索引（IVF_FLAT + COSINE，与参考代码一致）
  console.log('\nCreating index...');
  await client.createIndex({
    collection_name: COLLECTION_NAME,
    field_name: 'vector',
    index_type: IndexType.IVF_FLAT,
    metric_type: MetricType.COSINE,
    params: { nlist: 1024 },
  });
  console.log('Index created');

  // 4. 加载 collection
  console.log('\nLoading collection...');
  await client.loadCollection({ collection_name: COLLECTION_NAME });
  console.log('Collection loaded');

  // 5. 测试 search（空 collection）
  console.log('\nTesting search on empty collection...');
  const testVector = Array(VECTOR_DIM).fill(0).map(() => Math.random());
  const searchStart = Date.now();
  try {
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: testVector,
      limit: 5,
      metric_type: MetricType.COSINE,
      output_fields: ['id', 'content', 'doc_id', 'chunk_index'],
    });
    console.log('Search took:', Date.now() - searchStart, 'ms');
    console.log('Search results:', searchResult.results.length);
  } catch (err) {
    console.log('Search failed after:', Date.now() - searchStart, 'ms');
    console.log('Error:', err.message);
  }

  console.log('\nDone. Now restart backend and upload document.');
}

main().catch(console.error);
