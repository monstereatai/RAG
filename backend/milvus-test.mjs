import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({
  address: '127.0.0.1:19530',
  timeout: 60000,
});

async function main() {
  await client.connectPromise;
  console.log('Connected');

  const collection = 'rag_chunks';

  // 测试 search（带 nprobe）
  console.log('\nTesting search with nprobe=16...');
  const dim = 1024;
  const testVector = Array(dim).fill(0).map(() => Math.random());
  const searchStart = Date.now();
  try {
    const searchResult = await client.search({
      collection_name: collection,
      vector: testVector,
      limit: 5,
      metric_type: MetricType.COSINE,
      params: { nprobe: 16 },
      output_fields: ['id', 'content', 'doc_id', 'chunk_index'],
    });
    console.log('Search took:', Date.now() - searchStart, 'ms');
    console.log('Search results:', searchResult.results.length);
    console.log('First hit score:', searchResult.results[0]?.score);
  } catch (err) {
    console.log('Search failed after:', Date.now() - searchStart, 'ms');
    console.log('Error:', err.message);
  }
}

main().catch(console.error);
