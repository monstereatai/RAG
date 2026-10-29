import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { LlmProvider } from './src/providers/llm/llm.provider';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const llm = app.get(LlmProvider);
  console.log('Invoking Qwen LLM natively...');
  const model = llm.getModel();
  
  try {
    const res = await model.invoke("say hello");
    console.log('Result:', res.content);
  } catch(e) {
    console.error('Error:', e);
  }
  await app.close();
}
main().catch(console.error);
