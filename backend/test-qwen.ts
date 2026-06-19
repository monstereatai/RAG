import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { LlmProvider } from './src/providers/llm/llm.provider';
import { z } from 'zod';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const llm = app.get(LlmProvider);
  console.log('Invoking Qwen LLM withStructuredOutput...');
  const model = llm.getModel();
  
  const schema = z.object({
    queries: z.array(z.string()).length(3),
  });
  
  const structured = model.withStructuredOutput(schema, { name: 'query_plan' });
  
  try {
    const res = await structured.invoke("hello");
    console.log('Result:', res);
  } catch(e) {
    console.error('Error:', e);
  }
  await app.close();
}
main().catch(console.error);
