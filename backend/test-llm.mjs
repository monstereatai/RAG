import { ChatOpenAI } from '@langchain/openai';
import 'dotenv/config';

async function main() {
  const model = new ChatOpenAI({
    modelName: 'qwen-turbo',
    openAIApiKey: process.env.DASHSCOPE_API_KEY,
    configuration: {
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
  });
  console.log('Invoking model...');
  const res = await model.invoke("say hello");
  console.log(res);
}
main().catch(console.error);
