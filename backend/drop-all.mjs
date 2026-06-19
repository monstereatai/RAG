import { MilvusClient } from '@zilliz/milvus2-sdk-node';
const client = new MilvusClient({ address: '127.0.0.1:19530', timeout: 60000 });
async function main() {
  await client.connectPromise;
  const cols = ['few_shot_examples', 'conversation_chunks'];
  for (const c of cols) {
    try {
      await client.dropCollection({ collection_name: c });
      console.log('Dropped', c);
    } catch (e) {
      console.log('Failed to drop', c, e.message);
    }
  }
}
main().catch(console.error);
