import { Module, Global } from '@nestjs/common';
import { Mem0Provider } from './mem0.provider';

@Global()
@Module({
  providers: [Mem0Provider],
  exports: [Mem0Provider],
})
export class Mem0Module {}
