import { MilvusClient, MetricType } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({
  address: '127.0.0.1:19530',
  timeout: 30000,
});

async function main() {
  await client.connectPromise;
  console.log('Connected');

  const collection = 'rag_chunks';

  // 1. 检查 collection 统计
  console.log('\n=== Collection Stats ===');
  const stats = await client.getCollectionStatistics({ collection_name: collection });
  console.log('Row count:', stats.data.row_count);

  // 2. 检查索引状态
  console.log('\n=== Index State ===');
  const indexState = await client.getIndexState({ collection_name: collection });
  console.log('Index state:', JSON.stringify(indexState, null, 2));

  // 3. 检查索引构建进度
  console.log('\n=== Index Build Progress ===');
  const indexBuildProgress = await client.getIndexBuildProgress({ collection_name: collection });
  console.log('Index build progress:', JSON.stringify(indexBuildProgress, null, 2));

  // 4. 检查 query segment info
  console.log('\n=== Query Segment Info ===');
  const querySegmentInfo = await client.getQuerySegmentInfo({ collection_name: collection });
  console.log('Query segment info:', JSON.stringify(querySegmentInfo, null, 2));

  // 5. 测试 search（带 nprobe）
  console.log('\n=== Test Search ===');
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
  } catch (err) {
    console.log('Search failed after:', Date.now() - searchStart, 'ms');
    console.log('Error:', err.message);
  }
}

main().catch(console.error);
