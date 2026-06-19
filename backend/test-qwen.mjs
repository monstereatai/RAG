import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { LlmProvider } from './src/providers/llm/llm.provider.js';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const llm = app.get(LlmProvider);
  console.log('Invoking Qwen LLM...');
  const res = await llm.invoke("say hello");
  console.log('Result:', res);
  await app.close();
}
main().catch(console.error);
